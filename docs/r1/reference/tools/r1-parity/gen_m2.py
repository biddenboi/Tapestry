"""Record Module 2 reference traces for the Rust test crates/lot-r1/tests/module2.rs.

    python3 tools/r1-parity/gen_m2.py PATH/TO/experimental/lab/core [OUT_DIR]

The reference is the lab's own code: the current R1 (lab core/r1v3.py, a copy of r1.py with a
skip(id, until) adapter) at margin 2, plus the lab's block and dependency layer
(models.InfoMixin.info_skips, blocks and dependencies only, no calendar capacity). This is
"R1new + Module 2" of final/1-model-description.md. The lab simulator (core/engine.py) drives it on
the lab families that have availability windows, minimum blocks and prerequisite chains.

Every input becomes a Rust event: item fields, then each item's block length and predecessor right
after it is added (the simulator sets them at the same instant), and each declined suggestion as a
hold. Each decision records the end of the planned availability window it saw (Module 2's ω).
"""
import json, os, sys

core = os.path.abspath(sys.argv[1])
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "../../crates/lot-r1/tests/fixtures")
sys.path.insert(0, core)
import hashlib  # noqa: E402
import models, r1v3  # noqa: E402
from engine import run, World, Opts  # noqa: E402
from scenarios import make_lab  # noqa: E402


def num(x):
    return None if x is None else float(x)


class M2(models.InfoMixin, r1v3.Lot):
    """R1new + Module 2, built from the lab's own pieces. Records its inputs as Rust events in order."""

    def __init__(self, P, rewards, rest):
        super().__init__(P, rewards, rest)
        self.use = ("blocks",)
        self.needs = {"calendar", "blocks", "deps"}
        self.rust = []          # events in Rust form, in the order the model saw them
        self.decisions = []
        self._seen = 0
        self._now = 0.0

    def _sync(self):
        """Copies reference events not yet recorded. The simulator sets an item's block length and
        predecessor right after adding it, before the next request, so they follow its add."""
        for e in self.events[self._seen:]:
            self.rust.append(ev_json(e))
            if e[0] == "add":
                id = e[1]
                self.rust.append(dict(ev="block", id=id, now=num(e[2]), block=num((self.info.get("min_block") or {}).get(id, 0.0))))
                self.rust.append(dict(ev="after", id=id, now=num(e[2]), after=(self.info.get("after") or {}).get(id)))
        self._seen = len(self.events)

    def decide(self, now):
        self._sync()
        omega = self.cal_window_end(now)
        self.info_skips(now)
        self._now = now
        d = super().decide(now)
        self.decisions.append(dict(after=len(self.rust), now=now, omega=num(omega), decision=dec_json(d)))
        return d

    def skip(self, id, until):
        self._sync()
        self.rust.append(dict(ev="hold", id=id, now=num(self._now), until=num(until)))
        super().skip(id, until)


def ev_json(e):
    k = e[0]
    if k == "add":
        _, id, now, Q, D, start, cycle, habit, cat = e
        return dict(ev="add", id=id, now=num(now), q=num(Q), d=num(D), start=num(start), cycle=num(cycle) or None,
                    habit=bool(habit), category=cat)
    if k == "estimate":
        return dict(ev="estimate", id=e[1], now=num(e[2]), q=num(e[3]))
    if k == "deadline":
        return dict(ev="deadline", id=e[1], now=num(e[2]), d=num(e[3]))
    if k == "start":
        return dict(ev="start", id=e[1], now=num(e[2]), start=num(e[3]))
    if k == "complete":
        return dict(ev="complete", id=e[1], now=num(e[2]))
    if k == "log":
        return dict(ev="log", start=num(e[1]), dur=num(e[2]), kind=e[3], ref=e[4])
    raise ValueError(k)


def alert_json(a):
    if a[0] == "overload":
        return dict(alert="overload", **{"from": num(a[1])}, to=num(a[2]), short=num(a[3]))
    return dict(alert="overdue", id=a[1])


def dec_json(d):
    return dict(kind=d.kind, ref=d.ref, length=num(d.length), rule=d.rule, mode=d.mode,
                alerts=[alert_json(a) for a in d.alerts], prompts=list(d.prompts), basis=d.basis)


def main():
    sha = hashlib.sha256(open(os.path.join(core, "r1v3.py"), "rb").read() + open(os.path.join(core, "models.py"), "rb").read()).hexdigest()
    os.makedirs(out, exist_ok=True)
    cases = []
    # Small enough to keep in the repository; one family each for blocks inside planned windows,
    # prerequisite chains, and both together.
    for fam, seed in (("fragmented", 910001), ("deps", 910003), ("deps", 910007), ("realistic", 910004), ("realistic", 910001)):
        sc = make_lab(fam, seed, H=21)
        lot = M2(r1v3.Params(kA=2.0), sc.rewards, sc.rest)
        run(sc, lot, World(), Opts())
        lot._sync()
        cases.append(dict(family=fam, seed=seed, s=lot.P.s, rewards=sc.rewards, rest=float(sc.rest),
                          events=lot.rust, decisions=lot.decisions))
    path = os.path.join(out, "m2_traces.json")
    with open(path, "w") as fh:
        json.dump(dict(lab_sha256=sha, cases=cases), fh, separators=(",", ":"))
    n = sum(len(c["decisions"]) for c in cases)
    held = sum(1 for c in cases for e in c["events"] if e["ev"] == "hold")
    deps = sum(1 for c in cases for e in c["events"] if e["ev"] == "after" and e["after"])
    blocks = sum(1 for c in cases for e in c["events"] if e["ev"] == "block" and e["block"] > 0)
    win = sum(1 for c in cases for d in c["decisions"] if d["omega"] is not None)
    print(f"{len(cases)} traces, {n} decisions ({win} inside a planned window), {blocks} blocks, {deps} predecessors, "
          f"{held} declines -> {path}")


if __name__ == "__main__":
    main()
