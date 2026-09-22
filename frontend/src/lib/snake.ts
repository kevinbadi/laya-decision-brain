export type Dir = "up" | "down" | "left" | "right";
export type Cell = "empty" | "food" | "body" | "wall";

export const DIRS: Dir[] = ["up", "down", "left", "right"];
export const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
export const DELTA: Record<Dir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export interface Pt {
  x: number;
  y: number;
}

export interface Game {
  size: number;
  snake: Pt[];
  dir: Dir;
  food: Pt;
  score: number;
  dead: boolean;
  won: boolean;
  tick: number;
  death?: "wall" | "body";
}

export const SIZE = 22;

export function eq(a: Pt, b: Pt) {
  return a.x === b.x && a.y === b.y;
}

export function manhattan(a: Pt, b: Pt) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function occupied(snake: Pt[], p: Pt, ignoreTail = false) {
  const end = ignoreTail ? snake.length - 1 : snake.length;
  return snake.slice(0, end).some((s) => eq(s, p));
}

function randomEmpty(size: number, snake: Pt[]): Pt {
  const free: Pt[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!occupied(snake, { x, y })) free.push({ x, y });
    }
  }
  return free[Math.floor(Math.random() * free.length)] ?? { x: 0, y: 0 };
}

export function createGame(size = SIZE): Game {
  const mid = Math.floor(size / 2);
  const snake = [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
  ];
  return {
    size,
    snake,
    dir: "right",
    // Fixed opening apple so the first client render matches the server.
    food: { x: size - 2, y: 1 },
    score: 0,
    dead: false,
    won: false,
    tick: 0,
  };
}

export function ahead(p: Pt, dir: Dir): Pt {
  const d = DELTA[dir];
  return { x: p.x + d.x, y: p.y + d.y };
}

export function inBounds(size: number, p: Pt) {
  return p.x >= 0 && p.y >= 0 && p.x < size && p.y < size;
}

/** Reverse is illegal. Wall/body are legal choices that kill. */
export function isReverse(game: Game, dir: Dir) {
  return dir === OPPOSITE[game.dir];
}

export function peek(game: Game, dir: Dir): Cell {
  const p = ahead(game.snake[0], dir);
  if (!inBounds(game.size, p)) return "wall";
  if (eq(p, game.food)) return "food";
  // Moving into the current tail is safe unless we also grow.
  const tail = game.snake[game.snake.length - 1];
  if (eq(p, tail)) return "empty";
  if (occupied(game.snake, p)) return "body";
  return "empty";
}

export function step(game: Game, dir: Dir): Game {
  if (game.dead || game.won) return game;
  const heading = isReverse(game, dir) ? game.dir : dir;
  const head = ahead(game.snake[0], heading);
  if (!inBounds(game.size, head)) return { ...game, dir: heading, dead: true, death: "wall", tick: game.tick + 1 };
  const eat = eq(head, game.food);
  if (occupied(game.snake, head, !eat)) return { ...game, dir: heading, dead: true, death: "body", tick: game.tick + 1 };
  const snake = [head, ...game.snake];
  if (!eat) snake.pop();
  if (snake.length === game.size * game.size) {
    return { ...game, snake, dir: heading, score: game.score + 1, won: true, tick: game.tick + 1 };
  }
  return {
    ...game,
    snake,
    dir: heading,
    food: eat ? randomEmpty(game.size, snake) : game.food,
    score: game.score + (eat ? 1 : 0),
    tick: game.tick + 1,
  };
}

export function ascii(game: Game) {
  const rows: string[] = [];
  for (let y = 0; y < game.size; y++) {
    let row = "";
    for (let x = 0; x < game.size; x++) {
      const p = { x, y };
      if (eq(p, game.snake[0])) row += "H";
      else if (occupied(game.snake, p)) row += "o";
      else if (eq(p, game.food)) row += "*";
      else row += ".";
    }
    rows.push(row);
  }
  return rows.join("\n");
}

export type Coach = "coached" | "raw";

function keyOf(p: Pt) {
  return `${p.x},${p.y}`;
}

/** Empty cells reachable after committing `dir`. 0 means the move dies. */
export function reachable(game: Game, dir: Dir) {
  if (isReverse(game, dir)) return 0;
  const head = ahead(game.snake[0], dir);
  if (!inBounds(game.size, head)) return 0;
  const eat = eq(head, game.food);
  const body = new Set(
    (eat ? game.snake : game.snake.slice(0, -1)).map(keyOf),
  );
  if (body.has(keyOf(head))) return 0;
  const seen = new Set<string>([keyOf(head)]);
  const q: Pt[] = [head];
  let n = 1;
  while (q.length) {
    const p = q.pop()!;
    for (const d of DIRS) {
      const np = ahead(p, d);
      const k = keyOf(np);
      if (seen.has(k) || !inBounds(game.size, np) || body.has(k)) continue;
      seen.add(k);
      q.push(np);
      n++;
    }
  }
  return n;
}

export function describeMove(game: Game, dir: Dir, need = game.snake.length) {
  const cell = peek(game, dir);
  const next = ahead(game.snake[0], dir);
  const now = manhattan(game.snake[0], game.food);
  const then = inBounds(game.size, next) ? manhattan(next, game.food) : now + 99;
  const reverse = isReverse(game, dir);
  const space = reverse || cell === "wall" || cell === "body" ? 0 : reachable(game, dir);
  return {
    cell,
    reverse,
    closer: then < now,
    farther: then > now,
    dist: then,
    space,
    trap: space > 0 && space < need,
  };
}

export function spaceNeeded(game: Game, caution = 0) {
  return game.snake.length + Math.min(10, caution * 2);
}

export function moveCriteria(game: Game, coach: Coach, caution = 0): Record<string, string> {
  if (coach === "raw") {
    return {
      up: "move the head one cell up",
      down: "move the head one cell down",
      left: "move the head one cell left",
      right: "move the head one cell right",
    };
  }
  const need = spaceNeeded(game, caution);
  return Object.fromEntries(
    DIRS.map((dir) => {
      const { cell, reverse, closer, dist, space, trap } = describeMove(game, dir, need);
      if (reverse) return [dir, "ILLEGAL. This is a 180° reverse into your own neck."];
      if (cell === "wall") return [dir, "DEATH. Hits the wall."];
      if (cell === "body") return [dir, "DEATH. Hits your own body."];
      if (trap) return [dir, `TRAP. ${space} open cells — you will box yourself. Never pick this.`];
      if (cell === "food") return [dir, `EAT. The apple is here. ${space} cells stay open. Choose this.`];
      if (closer) return [dir, `HUNT. Closer to the apple (${dist} left), ${space} cells open. Prefer the most open HUNT.`];
      return [dir, `DRIFT. Farther from the apple (${dist} left), ${space} cells open. Avoid if a HUNT/EAT exists.`];
    }),
  );
}

export interface Lesson {
  n: number;
  score: number;
  death: "wall" | "body";
  length: number;
  note: string;
}

export function makeLesson(game: Game, n: number): Lesson {
  const head = game.snake[0];
  const blocked = DIRS.filter((d) => {
    const c = peek(game, d);
    return c === "wall" || c === "body";
  }).length;
  const death = game.death ?? "body";
  const note =
    death === "wall"
      ? `game ${n} scored ${game.score}: hit a wall heading ${game.dir} at ${head.x},${head.y}. Stay off the rim unless the apple is there.`
      : `game ${n} scored ${game.score}: hit your body heading ${game.dir} at ${head.x},${head.y}. ${blocked}/4 sides blocked. Never close a pocket — keep a corridor open.`;
  return { n, score: game.score, death, length: game.snake.length, note };
}

export function toLayaState(game: Game, career?: { best: number; games: number; lessons: Lesson[] }) {
  const head = game.snake[0];
  const dx = game.food.x - head.x;
  const dy = game.food.y - head.y;
  const boxed = (career?.lessons ?? []).some((l) => l.death === "body");
  return {
    apple: `${dy === 0 ? "" : dy < 0 ? `${-dy} up` : `${dy} down`}${dx !== 0 && dy !== 0 ? " " : ""}${
      dx === 0 ? "" : dx < 0 ? `${-dx} left` : `${dx} right`
    }`.trim() || "here",
    heading: game.dir,
    hunt: [dy < 0 && "up", dy > 0 && "down", dx < 0 && "left", dx > 0 && "right"].filter(Boolean).join(" "),
    adj: Object.fromEntries(DIRS.map((d) => [d, peek(game, d)])),
    rule: boxed ? "avoid TRAP pockets" : "hunt apple",
  };
}

export function moveCriteriaForModel(game: Game, caution = 0): Record<string, string> {
  const need = spaceNeeded(game, caution);
  return Object.fromEntries(
    DIRS.map((dir) => {
      const { cell, reverse, closer, trap } = describeMove(game, dir, need);
      if (reverse) return [dir, "ILLEGAL"];
      if (cell === "wall") return [dir, "DEATH"];
      if (cell === "body") return [dir, "DEATH"];
      if (trap) return [dir, "TRAP"];
      if (cell === "food") return [dir, "EAT"];
      if (closer) return [dir, "HUNT"];
      return [dir, "DRIFT"];
    }),
  );
}

export const MOVE_QUESTION = {
  type: "choice" as const,
  instructions: "Snake. Pick EAT, else HUNT, never DEATH ILLEGAL TRAP.",
};

/** If the seatbelt already has one legal play, skip Laya. */
export function obviousMove(game: Game, caution = 0): Dir | null {
  const safe = safeMoves(game);
  if (safe.length === 0) return null;
  if (safe.length === 1) return safe[0];
  const need = spaceNeeded(game, caution);
  const scored = safe.map((d) => ({ d, ...describeMove(game, d, need) }));
  const eat = scored.filter((s) => s.cell === "food");
  if (eat.length === 1) return eat[0].d;
  const hunt = scored.filter((s) => s.closer && !s.trap);
  if (hunt.length === 1) return hunt[0].d;
  return null;
}

export function isSafe(game: Game, dir: Dir) {
  if (isReverse(game, dir)) return false;
  const cell = peek(game, dir);
  return cell === "empty" || cell === "food";
}

export function safeMoves(game: Game): Dir[] {
  return DIRS.filter((d) => isSafe(game, d));
}

export function resolveMove(
  game: Game,
  wanted: string,
  probs?: Record<string, number>,
  caution = 0,
): { dir: Dir; overridden: boolean; reason: string | null } {
  const choice = DIRS.includes(wanted as Dir) ? (wanted as Dir) : game.dir;
  const safe = safeMoves(game);
  if (safe.length === 0) return { dir: choice, overridden: false, reason: null };
  const need = spaceNeeded(game, caution);
  const scored = safe.map((d) => {
    const info = describeMove(game, d, need);
    return { d, ...info, p: probs?.[d] ?? 0 };
  });
  const open = scored.filter((s) => !s.trap);
  const base = open.length ? open : scored;
  const eat = base.filter((s) => s.cell === "food");
  const hunt = base.filter((s) => s.closer);
  const pool = eat.length ? eat : hunt.length ? hunt : base;
  const ranked = [...pool].sort((a, b) => b.space - a.space || b.p - a.p);
  const dir = ranked[0].d;
  if (dir === choice) return { dir, overridden: false, reason: null };
  const picked = scored.find((s) => s.d === choice);
  const why = !safe.includes(choice)
    ? `${choice} was ${isReverse(game, choice) ? "a reverse" : peek(game, choice)}`
    : picked?.trap
      ? `${choice} was a pocket (${picked.space} open)`
      : picked && !picked.closer && hunt.length
        ? `${choice} drifted off the apple`
        : `${choice} left less room`;
  return { dir, overridden: true, reason: why };
}
