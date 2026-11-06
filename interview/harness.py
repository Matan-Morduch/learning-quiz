# Runs LeetCode-style Python against test cases. Started by interview-runner.js as
#   python3 -I harness.py   (cwd = a fresh temp folder holding solution.py), the job as JSON on stdin.
#
# Job (mode "run", the default):
#   { "method": "twoSum" | null (design problem), "compare": "exact"|"unordered"|"unordered-inner"|"float",
#     "inplace": null | <arg index> (the answer is that argument after the call, e.g. sortColors(nums)),
#     "check": null | python source defining check(args, got, expected) -> bool (several valid answers),
#     "timeLimitMs": 2000,
#     "tests": [ {"args": [...], "expected": ...}, or for design problems
#                {"ops": ["MinStack","push",...], "args": [[],[1],...], "expected": [null,...]} ] }
#   A test without "expected" just records what the code returns (used to compute expected answers
#   from the reference solution).
# Job (mode "gen"): solution.py defines cases() -> list of tests without expected; they're returned as-is.
#
# Writes one JSON line per test to results.jsonl: {i, ok, got?, error?, line?, ms, stdout?}, then
# {"done": true}. (A file, not stdout, so nothing the code prints can fake a result.)
# The time limit is per test (SIGALRM), so an infinite loop fails that test and the rest still run.
import copy, io, json, math, signal, sys, time, traceback, contextlib

class TimeLimit(Exception):
    pass

def on_alarm(signum, frame):
    raise TimeLimit()

def canon(v):
    if isinstance(v, (tuple, list)):
        return [canon(x) for x in v]
    return v

def norm(v, mode):
    v = canon(v)
    if mode == 'unordered' and isinstance(v, list):
        return sorted(v, key=repr)
    if mode == 'unordered-inner' and isinstance(v, list):
        return sorted((sorted(x, key=repr) if isinstance(x, list) else x for x in v), key=repr)
    return v

def same(got, exp, mode):
    if mode == 'float':
        try:
            return math.isclose(float(got), float(exp), rel_tol=1e-5, abs_tol=1e-5)
        except (TypeError, ValueError):
            return False
    return norm(got, mode) == norm(exp, mode)

def error_line():
    tb = traceback.extract_tb(sys.exc_info()[2])
    mine = [f for f in tb if f.filename == 'solution.py']
    return mine[-1].lineno if mine else None

RESULTS = open('results.jsonl', 'w')

def out(obj):
    RESULTS.write(json.dumps(obj, default=repr) + '\n')
    RESULTS.flush()

def namespace():
    from typing import List, Optional, Dict, Set, Tuple
    import collections, heapq, bisect, itertools, functools, random, string
    return {'__name__': 'solution', 'List': List, 'Optional': Optional, 'Dict': Dict, 'Set': Set, 'Tuple': Tuple,
            'collections': collections, 'heapq': heapq, 'bisect': bisect, 'itertools': itertools,
            'functools': functools, 'math': math, 'random': random, 'string': string,
            'deque': collections.deque, 'defaultdict': collections.defaultdict, 'Counter': collections.Counter,
            'inf': math.inf}

def main():
    job = json.load(sys.stdin)
    ns = namespace()
    src = open('solution.py').read()
    try:
        exec(compile(src, 'solution.py', 'exec'), ns)
    except BaseException as e:
        line = getattr(e, 'lineno', None) or error_line()
        out({'compileError': f'{type(e).__name__}: {e}', 'line': line})
        out({'done': True})
        return
    if job.get('mode') == 'gen':
        try:
            cases = ns['cases']()
            out({'cases': json.loads(json.dumps(canon(cases)))})
        except BaseException as e:
            out({'compileError': f'cases() failed: {type(e).__name__}: {e}', 'line': error_line()})
        out({'done': True})
        return
    check = None
    if job.get('check'):
        cns = namespace()
        exec(compile(job['check'], 'check.py', 'exec'), cns)
        check = cns['check']
    mode = job.get('compare', 'exact')
    inplace = job.get('inplace')
    limit = max(0.05, job.get('timeLimitMs', 2000) / 1000)
    signal.signal(signal.SIGALRM, on_alarm)
    for i, t in enumerate(job['tests']):
        buf = io.StringIO()
        res = {'i': i}
        start = time.perf_counter()
        try:
            signal.setitimer(signal.ITIMER_REAL, limit)
            with contextlib.redirect_stdout(buf):
                args = copy.deepcopy(t['args'])
                if job.get('method'):
                    sol = ns['Solution']()
                    got = getattr(sol, job['method'])(*args)
                    if inplace is not None:
                        got = args[inplace]
                else:
                    ops = t['ops']
                    obj = ns[ops[0]](*args[0])
                    got = [None] + [getattr(obj, op)(*a) for op, a in zip(ops[1:], args[1:])]
            signal.setitimer(signal.ITIMER_REAL, 0)
            res['ms'] = round((time.perf_counter() - start) * 1000, 2)
            got = canon(got)
            res['got'] = got
            if 'expected' in t:
                res['ok'] = bool(check(copy.deepcopy(t['args']), got, t['expected'])) if check else same(got, t['expected'], mode)
            else:
                res['ok'] = True
        except TimeLimit:
            res.update(ok=False, error='Time limit exceeded', timeout=True)
        except RecursionError:
            signal.setitimer(signal.ITIMER_REAL, 0)
            res.update(ok=False, error='RecursionError: maximum recursion depth exceeded', line=error_line())
        except MemoryError:
            signal.setitimer(signal.ITIMER_REAL, 0)
            res.update(ok=False, error='MemoryError', memory=True)
        except BaseException as e:
            signal.setitimer(signal.ITIMER_REAL, 0)
            res.update(ok=False, error=f'{type(e).__name__}: {e}', line=error_line())
        if 'ms' not in res:
            res['ms'] = round((time.perf_counter() - start) * 1000, 2)
        printed = buf.getvalue()
        if printed:
            res['stdout'] = printed[:2000]
        out(res)
    out({'done': True})

main()
