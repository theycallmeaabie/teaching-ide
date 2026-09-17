/**
 * Python shipped into the Pyodide worker at boot.
 *
 * `_teaching_ide_run` runs learner source in a fresh namespace and reports
 * failures structurally. Compile errors and runtime errors are distinguished,
 * and the line number is resolved against the learner's own frames only, never
 * our harness frames.
 */
export const HARNESS = `
import json as _json

def _teaching_ide_run(src):
    ns = {'__name__': '__main__'}
    try:
        code = compile(src, '<learner>', 'exec')
    except SyntaxError as e:
        return _json.dumps({
            'ok': False,
            'type': type(e).__name__,
            'message': e.msg or str(e),
            'line': e.lineno,
        })
    try:
        exec(code, ns)
    except BaseException as e:
        tb = e.__traceback__
        line = None
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == '<learner>':
                line = tb.tb_lineno
            tb = tb.tb_next
        message = str(e)
        if isinstance(e, SyntaxError):
            message = e.msg or message
            line = e.lineno or line
        return _json.dumps({
            'ok': False,
            'type': type(e).__name__,
            'message': message,
            'line': line,
        })
    return _json.dumps({'ok': True, 'type': None, 'message': None, 'line': None})
`

/**
 * Phase 2b — structural comparison of the learner's buffer between edit batches.
 *
 * `dump` is a plain `ast.dump()`: identical dumps mean the edit was cosmetic
 * (whitespace, blank lines, comments, retyping a line as it already was).
 *
 * `shape` is the same dump with learner-chosen identifiers canonicalised to
 * v0, v1, ... so a pure rename produces an unchanged shape. Builtins are left
 * alone, otherwise `print` would be indistinguishable from a variable.
 */
export const AST_HARNESS = `
import ast as _ast
import builtins as _builtins

_KEEP = set(dir(_builtins))

class _Canon(_ast.NodeTransformer):
    def __init__(self):
        self.names = {}

    def _canon(self, name):
        if name in _KEEP:
            return name
        if name not in self.names:
            self.names[name] = 'v%d' % len(self.names)
        return self.names[name]

    def visit_Name(self, node):
        node.id = self._canon(node.id)
        return node

    def visit_arg(self, node):
        node.arg = self._canon(node.arg)
        return node

    def visit_FunctionDef(self, node):
        node.name = self._canon(node.name)
        self.generic_visit(node)
        return node

def _teaching_ide_ast(src):
    try:
        tree = _ast.parse(src)
    except SyntaxError as e:
        return _json.dumps({
            'parses': False,
            'dump': None,
            'shape': None,
            'type': type(e).__name__,
            'message': e.msg or str(e),
            'line': e.lineno,
        })
    dump = _ast.dump(tree)
    shape = _ast.dump(_Canon().visit(_ast.parse(src)))
    return _json.dumps({'parses': True, 'dump': dump, 'shape': shape})
`

/**
 * Phase 3 — the known beginner failure modes, as AST shapes.
 *
 * These are the ones that matter most because several of them *run clean*:
 * an accumulator reset inside the loop produces no error at all, just a wrong
 * number. An error type cannot find those; only the shape of the code can.
 */
export const DIAGNOSE_HARNESS = `
def _ti_names(node):
    return {n.id for n in _ast.walk(node) if isinstance(n, _ast.Name)}

def _teaching_ide_diagnose(src):
    found = []

    def flag(mid, line):
        if not any(f['id'] == mid and f['line'] == line for f in found):
            found.append({'id': mid, 'line': line})

    try:
        tree = _ast.parse(src)
    except SyntaxError:
        return _json.dumps(found)

    body = tree.body
    loops = [n for n in _ast.walk(tree) if isinstance(n, _ast.For)]
    if not loops:
        flag('no-loop', None)

    for f in loops:
        target = f.target.id if isinstance(f.target, _ast.Name) else None

        # nums[i] where the loop already handed you the value, not the index.
        # Only when iterating the list directly: 'for i in range(len(nums))'
        # makes i a genuine index and nums[i] is correct there.
        if target and isinstance(f.iter, _ast.Name):
            for n in _ast.walk(f):
                if (isinstance(n, _ast.Subscript)
                        and isinstance(n.value, _ast.Name)
                        and n.value.id == f.iter.id
                        and isinstance(n.slice, _ast.Name)
                        and n.slice.id == target):
                    flag('index-value-confusion', n.lineno)
                    break

        # range(...) arithmetic, or starting from 1.
        if (isinstance(f.iter, _ast.Call)
                and isinstance(f.iter.func, _ast.Name)
                and f.iter.func.id == 'range'):
            for a in f.iter.args:
                if isinstance(a, _ast.BinOp) and isinstance(a.op, (_ast.Add, _ast.Sub)):
                    flag('range-off-by-one', f.lineno)
            if f.iter.args:
                a0 = f.iter.args[0]
                if len(f.iter.args) >= 2 and isinstance(a0, _ast.Constant) and a0.value == 1:
                    flag('range-off-by-one', f.lineno)

        # What happens to names inside the loop body.
        init_in_loop = {}
        accumulated = set()
        reassigned = {}
        for st in _ast.walk(f):
            if isinstance(st, _ast.AugAssign) and isinstance(st.target, _ast.Name):
                accumulated.add(st.target.id)
            elif (isinstance(st, _ast.Assign) and len(st.targets) == 1
                    and isinstance(st.targets[0], _ast.Name)):
                nm = st.targets[0].id
                if isinstance(st.value, _ast.Constant):
                    init_in_loop[nm] = st.lineno
                elif nm in _ti_names(st.value):
                    accumulated.add(nm)
                else:
                    reassigned[nm] = st.lineno

        # The important one: set to a constant AND built up, both inside the loop.
        for nm, ln in init_in_loop.items():
            if nm in accumulated:
                flag('accumulator-init-inside-loop', ln)

        # Names set to a constant before this loop starts.
        init_before = {}
        for st in body:
            if st is f:
                break
            if (isinstance(st, _ast.Assign) and len(st.targets) == 1
                    and isinstance(st.targets[0], _ast.Name)
                    and isinstance(st.value, _ast.Constant)):
                init_before[st.targets[0].id] = st.lineno

        # total = n, where total was meant to be accumulating.
        for nm, ln in reassigned.items():
            if nm in init_before and nm not in accumulated:
                flag('accumulator-reassigned', ln)

        # print(total) inside the loop: prints once per item instead of once.
        carriers = accumulated | set(init_before)
        for n in _ast.walk(f):
            if (isinstance(n, _ast.Call) and isinstance(n.func, _ast.Name)
                    and n.func.id == 'print'):
                args = set()
                for a in n.args:
                    args |= _ti_names(a)
                if (args & carriers) and target not in args:
                    flag('accumulator-printed-inside-loop', n.lineno)
                    break

    # Loop body left outside the loop: the statement after it still uses the
    # loop variable, so it runs once on the last value instead of every time.
    for i, st in enumerate(body):
        if isinstance(st, _ast.For) and isinstance(st.target, _ast.Name):
            t = st.target.id
            for later in body[i + 1:]:
                if t in _ti_names(later):
                    flag('loop-body-outside', later.lineno)
                    break

    return _json.dumps(found)
`
