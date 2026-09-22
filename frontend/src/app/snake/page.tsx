"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type LayaAnswer } from "@/lib/api";
import {
  DIRS,
  MOVE_QUESTION,
  createGame,
  makeLesson,
  moveCriteria,
  moveCriteriaForModel,
  obviousMove,
  resolveMove,
  step,
  toLayaState,
  type Coach,
  type Dir,
  type Game,
  type Lesson,
} from "@/lib/snake";
import { AppNav } from "@/components/AppNav";
import { Button, Segmented } from "@/components/ui";

type Driver = "laya" | "human";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const ARROW: Record<Dir, string> = { up: "▲", down: "▼", left: "◀", right: "▶" };

const SPEEDS = [
  { id: 1, label: "slow", human: 280, laya: 220 },
  { id: 2, label: "easy", human: 180, laya: 120 },
  { id: 3, label: "norm", human: 140, laya: 50 },
  { id: 4, label: "fast", human: 80, laya: 10 },
  { id: 5, label: "max", human: 40, laya: 0 },
] as const;

export default function SnakePage() {
  const [game, setGame] = useState<Game>(() => createGame());
  const [driver, setDriver] = useState<Driver>("laya");
  const [coach, setCoach] = useState<Coach>("coached");
  const [playing, setPlaying] = useState(false);
  const [thought, setThought] = useState<LayaAnswer | null>(null);
  const [played, setPlayed] = useState<Dir | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [best, setBest] = useState(0);
  const [games, setGames] = useState(0);
  const [eaten, setEaten] = useState(0);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [speed, setSpeed] = useState(3);

  const careerRef = useRef({ best: 0, games: 0, lessons: [] as Lesson[] });
  const speedRef = useRef(speed);

  const gameRef = useRef(game);
  const playRef = useRef(false);
  const loopRef = useRef(0);
  const driverRef = useRef(driver);
  const coachRef = useRef(coach);
  const queued = useRef<Dir | null>(null);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);
  useEffect(() => {
    driverRef.current = driver;
  }, [driver]);
  useEffect(() => {
    coachRef.current = coach;
  }, [coach]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    api.health().catch(() => setOffline(true));
    try {
      const raw = localStorage.getItem("laya-snake-career");
      if (!raw) return;
      const saved = JSON.parse(raw) as { best?: number; games?: number; eaten?: number; lessons?: Lesson[] };
      if (saved.best) setBest(saved.best);
      if (saved.games) setGames(saved.games);
      if (saved.eaten) setEaten(saved.eaten);
      if (saved.lessons?.length) setLessons(saved.lessons.slice(-12));
      const storedSpeed = Number(localStorage.getItem("laya-snake-speed"));
      if (SPEEDS.some((s) => s.id === storedSpeed)) setSpeed(storedSpeed);
    } catch {
      /* ignore bad cache */
    }
  }, []);

  useEffect(() => {
    careerRef.current = { best, games, lessons };
    try {
      localStorage.setItem("laya-snake-career", JSON.stringify({ best, games, eaten, lessons: lessons.slice(-12) }));
    } catch {
      /* private mode */
    }
  }, [best, games, eaten, lessons]);

  const apply = useCallback((next: Game, prevScore: number) => {
    gameRef.current = next;
    setGame(next);
    if (next.score > prevScore) setEaten((n) => n + 1);
    setBest((b) => (next.score > b ? next.score : b));
    if (next.dead || next.won) {
      playRef.current = false;
      setPlaying(false);
      setGames((n) => n + 1);
      if (next.dead) {
        setLessons((prev) => {
          const n = prev.length ? prev[prev.length - 1].n + 1 : 1;
          return [...prev, makeLesson(next, n)].slice(-12);
        });
      }
    }
  }, []);

  const askLaya = useCallback(async (g: Game) => {
    const t0 = performance.now();
    const career = careerRef.current;
    const caution = career.lessons.filter((l) => l.death === "body").length;
    const res = await api.evaluate(toLayaState(g, career), {
      move: { ...MOVE_QUESTION, criteria: moveCriteriaForModel(g, caution) },
    });
    setLastMs(Math.round(performance.now() - t0));
    const ans = res.answers.move;
    setThought(ans);
    const decided = resolveMove(g, ans.choice ?? g.dir, ans.probabilities, caution);
    setOverride(decided.overridden ? decided.reason : null);
    setPlayed(decided.dir);
    return decided.dir;
  }, []);

  const loop = useCallback(async (id: number) => {
    while (playRef.current && loopRef.current === id) {
      const g = gameRef.current;
      if (g.dead || g.won) break;
      try {
        setError(null);
        let dir: Dir;
        const tick = SPEEDS.find((s) => s.id === speedRef.current) ?? SPEEDS[2];
        if (driverRef.current === "human") {
          dir = queued.current ?? g.dir;
          queued.current = null;
          setPlayed(dir);
          await sleep(tick.human);
        } else {
          const caution = careerRef.current.lessons.filter((l) => l.death === "body").length;
          const instant = obviousMove(g, caution);
          if (instant) {
            dir = instant;
            setPlayed(dir);
            setOverride(null);
            await sleep(tick.laya || 40);
          } else {
            dir = await askLaya(g);
            if (tick.laya) await sleep(tick.laya);
          }
        }
        if (!playRef.current || loopRef.current !== id) break;
        apply(step(g, dir), g.score);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        playRef.current = false;
        setPlaying(false);
        break;
      }
    }
  }, [apply, askLaya]);

  const start = () => {
    if (gameRef.current.dead || gameRef.current.won) {
      const fresh = createGame();
      gameRef.current = fresh;
      setGame(fresh);
      setThought(null);
      setOverride(null);
      setPlayed(null);
    }
    playRef.current = true;
    setPlaying(true);
    loopRef.current += 1;
    loop(loopRef.current);
  };

  const pause = () => {
    playRef.current = false;
    setPlaying(false);
  };

  const reset = () => {
    pause();
    const fresh = createGame();
    gameRef.current = fresh;
    setGame(fresh);
    setThought(null);
    setOverride(null);
    setPlayed(null);
    setError(null);
  };

  const stepOnce = async () => {
    if (playing || game.dead || game.won) return;
    try {
      const dir = driver === "laya" ? await askLaya(game) : (queued.current ?? game.dir);
      queued.current = null;
      apply(step(game, dir), game.score);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        w: "up",
        s: "down",
        a: "left",
        d: "right",
      };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      queued.current = dir;
      if (driverRef.current !== "human") setDriver("human");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => {
    playRef.current = false;
  }, []);

  const probs = thought?.probabilities;
  const caution = lessons.filter((l) => l.death === "body").length;
  const criteria = moveCriteria(game, coach, caution);
  const maxP = Math.max(0.01, ...DIRS.map((d) => probs?.[d] ?? 0));

  return (
    <div className="snake-screen flex flex-col">
      <div className="mx-auto flex h-full w-full max-w-[1600px] min-h-0 flex-col px-4">
        <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
          <h1 className="text-[20px] font-bold tracking-[-0.04em] text-white">
            SNAKE<span className="text-lime">/</span>LAYA
          </h1>
          <AppNav here="snake" />
          <span className={`font-mono text-[11px] ${offline ? "text-rose" : "text-lime"}`}>
            {offline ? "OFFLINE" : "● LIVE"}
          </span>
          <span className="ml-auto font-mono text-[12px] text-white/45">
            {game.size}×{game.size} · arrows take over
          </span>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_200px_minmax(300px,380px)] gap-3 pb-3">
          <section className="flex min-h-0 flex-col">
            <div className="cabinet-bezel">
              <div className="flex shrink-0 items-center gap-3 pb-2">
                <div className="font-mono text-[28px] leading-none text-lime tabular-nums">{String(game.score).padStart(3, "0")}</div>
                <div className="font-mono text-[12px] text-white/45">
                  best {String(best).padStart(3, "0")} · len {game.snake.length} · {eaten} eaten · {games} games
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  {playing ? (
                    <Button className="!px-2.5 !py-1 !text-[12px]" onClick={pause}>
                      Pause
                    </Button>
                  ) : (
                    <Button className="!px-2.5 !py-1 !text-[12px]" onClick={start} disabled={offline && driver === "laya"}>
                      {game.dead || game.won ? "Play again" : "Play"}
                    </Button>
                  )}
                  <Button className="!px-2.5 !py-1 !text-[12px]" variant="ghost" onClick={stepOnce} disabled={playing || game.dead || game.won || (offline && driver === "laya")}>
                    Step
                  </Button>
                  <Button className="!px-2.5 !py-1 !text-[12px]" variant="ghost" onClick={reset}>
                    Reset
                  </Button>
                  <Segmented<Driver>
                    value={driver}
                    onChange={(d) => {
                      setDriver(d);
                      queued.current = null;
                    }}
                    options={[
                      { value: "laya", label: "Laya" },
                      { value: "human", label: "You" },
                    ]}
                  />
                  <label className="flex items-center gap-2 pl-1 font-mono text-[11px] text-white/45">
                    speed
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={speed}
                      aria-label="Snake speed"
                      className="h-1 w-[72px] cursor-pointer accent-[#8dff78]"
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setSpeed(next);
                        try {
                          localStorage.setItem("laya-snake-speed", String(next));
                        } catch {
                          /* private mode */
                        }
                      }}
                    />
                    <span className="w-8 text-lime">{SPEEDS[speed - 1].label}</span>
                  </label>
                </div>
              </div>
              <div className={`cabinet-screen ${game.dead ? "is-dead" : ""} ${game.won ? "is-won" : ""}`}>
                <div
                  className="snake-grid"
                  style={{ gridTemplateColumns: `repeat(${game.size}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: game.size * game.size }, (_, i) => {
                    const x = i % game.size;
                    const y = Math.floor(i / game.size);
                    const idx = game.snake.findIndex((p) => p.x === x && p.y === y);
                    const isHead = idx === 0;
                    const isBody = idx > 0;
                    const isFood = game.food.x === x && game.food.y === y;
                    const toward =
                      isFood ||
                      (played &&
                        ((played === "right" && x > game.snake[0].x && y === game.snake[0].y) ||
                          (played === "left" && x < game.snake[0].x && y === game.snake[0].y) ||
                          (played === "down" && y > game.snake[0].y && x === game.snake[0].x) ||
                          (played === "up" && y < game.snake[0].y && x === game.snake[0].x)));
                    return (
                      <div
                        key={i}
                        className={`snake-cell ${isHead ? "is-head" : isBody ? "is-body" : isFood ? "is-food" : toward && !isBody ? "is-path" : ""}`}
                      >
                        {isHead && <span>{ARROW[game.dir]}</span>}
                      </div>
                    );
                  })}
                </div>
                {(game.dead || game.won) && (
                  <div className="cabinet-overlay">
                    <div className={`font-mono text-[22px] ${game.won ? "text-lime" : "text-rose"}`}>
                      {game.won ? "CLEARED" : `DEAD · ${game.death?.toUpperCase()}`}
                    </div>
                    <div className="mt-1 font-mono text-[13px] text-white/60">SCORE {game.score}</div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-2">
            <div className="flex shrink-0 items-baseline justify-between">
              <h2 className="text-[14px] font-semibold text-white">This turn</h2>
              {lastMs !== null && <span className="font-mono text-[11px] text-white/40">{lastMs}ms</span>}
            </div>
            <div className="grid min-h-0 flex-1 grid-rows-4 gap-1.5">
              {DIRS.map((dir) => {
                const p = probs?.[dir];
                const voted = thought?.choice === dir;
                const going = played === dir;
                return (
                  <div
                    key={dir}
                    className={`flex min-h-0 flex-col justify-center rounded-lg border px-2.5 py-2 ${
                      going ? "border-lime bg-lime/10" : voted ? "border-amber/50 bg-amber/5" : "border-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14px] font-semibold text-white">
                        {ARROW[dir]} {dir}
                      </span>
                      <span className={`font-mono text-[22px] font-bold leading-none tabular-nums ${going ? "text-lime" : "text-white"}`}>
                        {p !== undefined ? Math.round(p * 100) : "—"}
                        <span className="text-[11px] font-medium text-white/40">%</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full ${going ? "bg-lime" : "bg-amber"}`}
                        style={{ width: `${p !== undefined ? (p / maxP) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {override && <p className="shrink-0 text-[12px] leading-snug text-rose">Corrected: {override}. Went {played}.</p>}
            {error && <p className="shrink-0 font-mono text-[12px] text-rose">{error}</p>}
            <div className="shrink-0 rounded-lg border border-white/10 px-2.5 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-[13px] font-semibold text-white">Career</h2>
                <span className="font-mono text-[11px] text-white/40">
                  {games}g{caution ? ` · ${caution} body` : ""}
                </span>
              </div>
              {lessons.length ? (
                <div className="mt-1 space-y-0.5 font-mono text-[11px] text-white/60">
                  {lessons
                    .slice(-3)
                    .reverse()
                    .map((l) => (
                      <div key={`${l.n}-${l.score}`} className={l.death === "body" ? "text-rose" : "text-amber"}>
                        #{l.n} {l.score} {l.death}
                      </div>
                    ))}
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-white/40">Lessons after a death.</p>
              )}
            </div>
          </aside>

          <aside className="flex min-h-0 flex-col gap-2">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <h2 className="text-[14px] font-semibold text-white">What Laya is reading</h2>
              <Segmented<Coach>
                value={coach}
                onChange={setCoach}
                options={[
                  { value: "coached", label: "Hunt" },
                  { value: "raw", label: "Raw" },
                ]}
              />
            </div>
            <div className="grid min-h-0 flex-1 grid-rows-4 gap-1.5">
              {DIRS.map((dir) => {
                const line = criteria[dir];
                const going = played === dir;
                const kind = line.startsWith("EAT")
                  ? "eat"
                  : line.startsWith("HUNT")
                    ? "hunt"
                    : line.startsWith("TRAP") || line.startsWith("DEATH") || line.startsWith("ILLEGAL")
                      ? "bad"
                      : "dim";
                return (
                  <div
                    key={dir}
                    className={`flex min-h-0 flex-col justify-center rounded-lg border px-3 py-2 ${
                      kind === "eat"
                        ? "border-lime/50 bg-lime/10 text-lime"
                        : kind === "bad"
                          ? "border-rose/35 bg-rose/5 text-rose"
                          : going
                            ? "border-white/25 bg-white/5 text-white"
                            : "border-white/10 text-white/80"
                    }`}
                  >
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] opacity-60">{dir}</span>
                    <p className="mt-1 text-[13px] leading-snug font-medium">{line}</p>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
