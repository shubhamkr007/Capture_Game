"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const SERVER_URL = 'http://localhost:4000';

export default function ResetGamePage() {
  const router = useRouter();
  const [status, setStatus] = useState('Resetting the game...');

  useEffect(() => {
    async function resetGame() {
      try {
        const response = await fetch(`${SERVER_URL}/reset-game`, { method: 'POST' });
        const data = await response.json();

        if (!data.ok) {
          setStatus(data.error || 'Game reset failed.');
          return;
        }

        router.replace('/');
      } catch (error) {
        setStatus('Unable to reset the game. Try again in a moment.');
      }
    }

    resetGame();
  }, [router]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-6 py-8">
      <div className="mx-auto max-w-3xl rounded-3xl border border-slate-700 bg-slate-900/80 p-10 text-center shadow-board backdrop-blur-xl">
        <p className="text-sm uppercase tracking-[0.3em] text-cyan-400/80">Reset game</p>
        <h1 className="mt-4 text-4xl font-semibold text-white">Resetting board state</h1>
        <p className="mt-4 text-slate-300">This page resets the shared board and redirects you back to the main game.</p>
        <p className="mt-6 rounded-2xl bg-slate-950/90 px-4 py-3 text-sm text-slate-200">{status}</p>
      </div>
    </main>
  );
}
