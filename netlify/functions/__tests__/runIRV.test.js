import { describe, it, expect } from 'vitest'
import pkg from '../get-results.js'
const { runIRV } = pkg


// Helpers to build the {votes, options} shape runIRV expects.
const opt = (id) => ({ id })
// a ballot is { rankings: [{ option_id, rank }] }
const ballot = (...orderedIds) => ({
  vote_rankings: orderedIds.map((option_id, i) => ({ option_id, rank: i + 1 })),
})

describe('runIRV — Droop quota', () => {
  it('computes floor(total/(winners+1))+1 for a single-winner race', () => {
    const votes = [ballot('a'), ballot('a'), ballot('b')]
    const { quota } = runIRV(votes, [opt('a'), opt('b')], 1)
    // floor(3/2)+1 = 2
    expect(quota).toBe(2)
  })

  it('scales the quota with the number of winners (multi-seat STV)', () => {
    const votes = Array.from({ length: 9 }, () => ballot('a'))
    const { quota } = runIRV(votes, [opt('a'), opt('b')], 2)
    // floor(9/3)+1 = 4
    expect(quota).toBe(4)
  })
})

describe('runIRV — single-winner outcomes', () => {
  it('elects an immediate majority winner in round 1', () => {
    const votes = [ballot('a'), ballot('a'), ballot('a'), ballot('b')]
    const { winners } = runIRV(votes, [opt('a'), opt('b')], 1)
    expect(winners).toEqual(['a'])
  })

  it('eliminates the lowest candidate and transfers to second preferences', () => {
    // a:2, b:2, c:1 with c voters preferring b second -> b should win after c is out
    const votes = [
      ballot('a'), ballot('a'),
      ballot('b'), ballot('b'),
      ballot('c', 'b'),
    ]
    const { winners, rounds } = runIRV(votes, [opt('a'), opt('b'), opt('c')], 1)
    expect(winners).toEqual(['b'])
    // there must be an elimination round naming c before b wins
    const elim = rounds.find(r => r.eliminated === 'c')
    expect(elim).toBeTruthy()
  })
})

describe('runIRV — multi-winner STV', () => {
  it('fills every seat requested', () => {
    const votes = [
      ballot('a'), ballot('a'), ballot('a'),
      ballot('b'), ballot('b'), ballot('b'),
      ballot('c'),
    ]
    const { winners } = runIRV(votes, [opt('a'), opt('b'), opt('c')], 2)
    expect(winners).toHaveLength(2)
    expect(winners).toEqual(expect.arrayContaining(['a', 'b']))
  })
})

describe('runIRV — tie-break by fewest ranking appearances', () => {
  it('eliminates the tied candidate that appears on fewer ballots', () => {
    // 6 ballots, 1 winner -> quota = floor(6/2)+1 = 4. First-choice counts are
    // a:2, b:2, c:2, so nobody reaches quota and all three tie at the minimum.
    // Tie-break eliminates the one on the fewest ballots overall. We give 'a' and
    // 'c' a down-ballot appearance but never list 'b' as anyone's later choice,
    // so 'b' (2 appearances vs 3) is eliminated first.
    const votes = [
      ballot('a', 'c'),
      ballot('a', 'c'),
      ballot('b'),
      ballot('b'),
      ballot('c', 'a'),
      ballot('c', 'a'),
    ]
    const { rounds } = runIRV(votes, [opt('a'), opt('b'), opt('c')], 1)
    const firstElim = rounds.find(r => r.eliminated !== null)
    expect(firstElim).toBeTruthy()
    expect(firstElim.eliminated).toBe('b')
  })
})

describe('runIRV — edge cases', () => {
  it('handles an empty ballot set without throwing', () => {
    expect(() => runIRV([], [opt('a')], 1)).not.toThrow()
  })
})
