import { useState } from 'react'

export default function IRVRounds({ rounds, optionMap, totalVotes, quota }) {
  const [activeRound, setActiveRound] = useState(0)

  if (!rounds || rounds.length === 0) return null

  const round = rounds[activeRound]

  // Sort entries: winners first, then by vote count desc, eliminated last
  const sortedEntries = Object.entries(round.counts).sort(([aId, aCount], [bId, bCount]) => {
    if (aId === round.winner) return -1
    if (bId === round.winner) return 1
    if (aId === round.eliminated) return 1
    if (bId === round.eliminated) return -1
    return bCount - aCount
  })

  const maxCount = Math.max(...Object.values(round.counts), quota, 1)
  const quotaPct = (quota / maxCount) * 100

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200">
        <h2 className="text-lg font-bold text-slate-800">Round-by-Round Simulation</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Votes needed to win: <strong>{quota}</strong> (= floor({totalVotes} ÷ {rounds.length > 0 ? (rounds[0].counts ? Object.keys(rounds[0].counts).length + (rounds.filter(r => r.winner).length) : '?') : '?'} + 1) + 1).
          Surplus votes are redistributed to next choices.
        </p>
      </div>

      {/* Round tabs */}
      <div className="flex gap-1 px-4 py-3 bg-slate-50 border-b border-slate-100 overflow-x-auto">
        {rounds.map((r, i) => (
          <button
            key={i}
            onClick={() => setActiveRound(i)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeRound === i
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {r.winner ? `Round ${i + 1} 🏆` : `Round ${i + 1}`}
          </button>
        ))}
      </div>

      {/* Round detail */}
      <div className="px-5 py-4 space-y-4">
        {/* Round summary pill */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500 font-medium">Round {activeRound + 1}</span>
          {round.winner && (
            <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-0.5 rounded-full">
              🏆 {optionMap[round.winner]?.title} wins
              {round.winner_surplus > 0 && ` · ${round.winner_surplus.toFixed(1)} surplus votes redistributed`}
            </span>
          )}
          {round.eliminated && (
            <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">
              ✕ {optionMap[round.eliminated]?.title} eliminated
            </span>
          )}
        </div>

        {/* Bar chart */}
        <div className="space-y-2.5">
          {sortedEntries.map(([optionId, count]) => {
            const option       = optionMap[optionId]
            const isWinner     = round.winner === optionId
            const isEliminated = round.eliminated === optionId
            const barPct       = (count / maxCount) * 100
            const displayCount = typeof count === 'number' ? count.toFixed(count % 1 === 0 ? 0 : 2) : count

            return (
              <div key={optionId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className={`font-medium truncate max-w-xs ${
                    isWinner     ? 'text-green-700' :
                    isEliminated ? 'text-red-500 line-through opacity-60' :
                    'text-slate-700'
                  }`}>
                    {isWinner    ? '🏆 ' : ''}
                    {isEliminated ? '✕ '  : ''}
                    {option?.title ?? optionId}
                  </span>
                  <span className="text-slate-500 text-xs ml-2 flex-shrink-0 tabular-nums">
                    {displayCount} vote{count !== 1 ? 's' : ''}
                    {totalVotes > 0 && ` (${((count / totalVotes) * 100).toFixed(1)}%)`}
                  </span>
                </div>

                {/* Bar container */}
                <div className="relative h-6 bg-slate-100 rounded-full overflow-hidden">
                  {/* Quota marker (dotted line) */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-slate-500 z-10 opacity-60"
                    style={{ left: `${quotaPct}%` }}
                  />

                  {/* Vote bar */}
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isWinner     ? 'bg-green-500' :
                      isEliminated ? 'bg-red-300'   :
                      'bg-brand-500'
                    }`}
                    style={{ width: `${Math.min(barPct, 100)}%` }}
                  />

                  {/* Surplus overlay — shows how far bar "reverts" back to quota */}
                  {isWinner && round.winner_surplus > 0 && (
                    <div
                      className="absolute top-0 h-full bg-green-200 opacity-70 rounded-r-full"
                      style={{
                        left:  `${quotaPct}%`,
                        width: `${Math.min(barPct - quotaPct, 100 - quotaPct)}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs text-slate-500 pt-1">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-slate-500 inline-block opacity-60" />
            Votes needed to win ({quota})
          </span>
          {rounds.some(r => r.winner_surplus > 0) && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-green-200 rounded inline-block" />
              Surplus redistributed to next choice
            </span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between px-5 py-3 bg-slate-50 border-t border-slate-100">
        <button
          onClick={() => setActiveRound(r => Math.max(0, r - 1))}
          disabled={activeRound === 0}
          className="btn-secondary text-sm disabled:opacity-40"
        >
          ← Previous Round
        </button>
        <button
          onClick={() => setActiveRound(r => Math.min(rounds.length - 1, r + 1))}
          disabled={activeRound === rounds.length - 1}
          className="btn-secondary text-sm disabled:opacity-40"
        >
          Next Round →
        </button>
      </div>
    </div>
  )
}
