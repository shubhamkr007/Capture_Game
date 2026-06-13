"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const GRID_SIZE = 40;
const CELL_SIZE = 18;
const SERVER_URL = 'http://localhost:4000';

type CellKey = string;

type BoardCell = {
  x: number;
  y: number;
  ownerId: string;
  ownerName: string;
  color: string;
};

type CellState = BoardCell;

type PlayerState = {
  id: string;
  name: string;
  color: string;
};

function getCellKey(x: number, y: number) {
  return `${x},${y}`;
}

function parseCellKey(key: CellKey) {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

function clampChannel(value: number) {
  return Math.min(255, Math.max(0, value));
}

function adjustColor(color: string, amount: number) {
  let hex = color.replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map((char) => char + char).join('');
  }

  const num = parseInt(hex, 16);
  const r = clampChannel((num >> 16) + amount);
  const g = clampChannel(((num >> 8) & 0xff) + amount);
  const b = clampChannel((num & 0xff) + amount);

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function drawBoardCell(ctx: CanvasRenderingContext2D, cell: BoardCell) {
  const px = cell.x * CELL_SIZE;
  const py = cell.y * CELL_SIZE;

  ctx.fillStyle = cell.color;
  ctx.fillRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)';
  ctx.strokeRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<any>(null);
  const [board, setBoard] = useState<Map<CellKey, BoardCell>>(() => new Map());
  const [leaderboard, setLeaderboard] = useState<Array<[string, number]>>([]);
  const [onlineUsers, setOnlineUsers] = useState<PlayerState[]>([]);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const boardArray = useMemo(() => Array.from(board.values()), [board]);

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket'],
      autoConnect: false,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setError(null);
    });

    socket.on('disconnect', () => {
      setError('Disconnected from the game server.');
    });

    socket.on('block_updated', (block: BoardCell) => {
      setBoard((current) => {
        const next = new Map(current);
        next.set(getCellKey(block.x, block.y), block);
        return next;
      });
    });

    socket.on('leaderboard', (list: Array<[string, number]>) => {
      setLeaderboard(list);
    });

    socket.on('user_list', (users: PlayerState[]) => {
      setOnlineUsers(users);
    });

    socket.on('game_reset', () => {
      setBoard(new Map());
      setOnlineUsers([]);
      setLeaderboard([]);
      setPlayer(null);
      setError('Game has been reset. Join again to start a new game.');
    });

    socket.connect();

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const displayWidth = GRID_SIZE * CELL_SIZE;
    const displayHeight = GRID_SIZE * CELL_SIZE;
    const ratio = window.devicePixelRatio || 1;

    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    canvas.width = displayWidth * ratio;
    canvas.height = displayHeight * ratio;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;

    for (let x = 0; x <= GRID_SIZE; x += 1) {
      ctx.beginPath();
      ctx.moveTo(x * CELL_SIZE, 0);
      ctx.lineTo(x * CELL_SIZE, displayHeight);
      ctx.stroke();
    }

    for (let y = 0; y <= GRID_SIZE; y += 1) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL_SIZE);
      ctx.lineTo(displayWidth, y * CELL_SIZE);
      ctx.stroke();
    }

    boardArray.forEach((cell) => drawBoardCell(ctx, cell));
  }, [boardArray]);

  const handleReset = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/reset-game`, { method: 'POST' });
      const data = await response.json();
      if (!data.ok) {
        setError(data.error || 'Failed to reset game.');
        return;
      }
      window.location.href = '/';
    } catch (error) {
      setError('Failed to reset game.');
    }
  };

  const handleJoin = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a display name.');
      return;
    }

    const socket = socketRef.current;
    if (!socket) {
      setError('Socket connection not ready yet.');
      return;
    }

    socket.emit('join', { name: trimmed }, (response: any) => {
      if (!response.ok) {
        setError(response.error || 'Failed to join the game.');
        return;
      }

      setPlayer(response.player ?? null);
      setOnlineUsers(response.users ?? []);
      setLeaderboard(response.leaderboard ?? []);

      const nextBoard = new Map<string, BoardCell>();
      response.board?.forEach((block: BoardCell) => {
        nextBoard.set(getCellKey(block.x, block.y), block);
      });
      setBoard(nextBoard);
      setError(null);
    });
  };

  const handleCanvasClick = (event: any) => {
    if (!player) {
      setError('Join the game before capturing blocks.');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * GRID_SIZE);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * GRID_SIZE);
    const key = getCellKey(x, y);

    const existing = board.get(key);
    if (existing?.ownerId === player.id) {
      return;
    }

    const socket = socketRef.current;
    socket?.emit('capture_block', { x, y }, (response: { ok: boolean; error?: string }) => {
      if (!response.ok) {
        setError(response.error || 'Capture failed.');
      }
    });
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="rounded-3xl border border-slate-700 bg-slate-900/80 p-8 shadow-board backdrop-blur-xl">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <p className="uppercase tracking-[0.35em] text-cyan-400/80">Realtime Territory Capture</p>
              <h1 className="text-4xl font-semibold tracking-tight text-white">Shared board with instant captures</h1>
              <p className="max-w-2xl text-slate-300">
                Enter a display name, and the server will assign you a unique color. Capture cells in real time and see the leaderboard update only when ownership changes.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-slate-700 bg-slate-950/90 p-4 text-center">
                <p className="text-sm uppercase text-slate-400">Players online</p>
                <p className="mt-1 text-3xl font-semibold text-cyan-300">{onlineUsers.length}</p>
              </div>
              <div className="rounded-3xl border border-slate-700 bg-slate-950/90 p-4 text-center">
                <p className="text-sm uppercase text-slate-400">Captured cells</p>
                <p className="mt-1 text-3xl font-semibold text-amber-300">{board.size}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-[1.6fr_0.9fr]">
          <div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-6 shadow-board backdrop-blur-xl">
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-slate-400">Your player</p>
                {player ? (
                  <div className="mt-2 flex items-center gap-3 rounded-2xl bg-slate-950/70 px-4 py-3">
                    <span className="h-4 w-4 rounded-full" style={{ backgroundColor: player.color }} />
                    <div>
                      <p className="text-lg font-semibold text-white">{player.name}</p>
                      <p className="text-sm text-slate-400">{player.color}</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">Enter your name to join the room.</p>
                )}
              </div>
              <div className="rounded-3xl border border-slate-700 bg-slate-950/90 p-4 text-center text-sm text-slate-300">
                <p className="uppercase tracking-[0.32em] text-slate-500">Board</p>
                <p className="mt-2 text-2xl font-semibold text-white">{GRID_SIZE}×{GRID_SIZE}</p>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-3xl border border-slate-700 bg-slate-950 shadow-inner">
              <canvas
                ref={canvasRef}
                className="block h-[720px] w-full cursor-crosshair"
                onClick={handleCanvasClick}
              />
            </div>

            <div className="mt-5 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
              <span>Tap any block to claim it.</span>
              <span>Server enforces ownership and avoids duplicate captures.</span>
            </div>
          </div>

          <aside className="space-y-6 rounded-3xl border border-slate-700 bg-slate-900/80 p-6 shadow-board backdrop-blur-xl">
            <div className="space-y-4 rounded-3xl border border-slate-700 bg-slate-950/70 p-4">
              <h2 className="text-lg font-semibold text-white">Player join</h2>
              <div className="space-y-3">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Enter your name"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                />
                <button
                  type="button"
                  onClick={handleJoin}
                  className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
                >
                  Join game
                </button>
                {error ? <p className="text-sm text-rose-400">{error}</p> : null}
              </div>
            </div>

            <div className="space-y-4 rounded-3xl border border-slate-700 bg-slate-950/70 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Leaderboard</h2>
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Live</span>
              </div>
              <div className="space-y-2">
                {leaderboard.length === 0 ? (
                  <p className="text-sm text-slate-500">Capture a block to get started.</p>
                ) : (
                  leaderboard.map(([owner, score]) => (
                    <div key={owner} className="flex items-center justify-between rounded-2xl bg-slate-900/90 px-3 py-2">
                      <span className="text-sm text-slate-100">{owner}</span>
                      <span className="text-sm text-slate-300">{score}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-700 bg-slate-950/80 p-4">
              <h2 className="text-lg font-semibold text-white">Players online</h2>
              <div className="mt-3 space-y-2">
                {onlineUsers.length === 0 ? (
                  <p className="text-sm text-slate-500">No players connected yet.</p>
                ) : (
                  <>
                    {onlineUsers.map((user) => (
                      <div key={user.id} className="flex items-center gap-3 rounded-2xl bg-slate-900/90 px-3 py-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: user.color }} />
                        <span className="text-sm text-slate-100">{user.name}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
