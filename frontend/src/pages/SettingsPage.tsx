import { FormEvent, useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { Config } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function SettingsPage() {
  const { idToken } = useAuth()
  const [config, setConfig] = useState<Config | null>(null)
  const [shareValue, setShareValue] = useState('')
  const [maxShares, setMaxShares] = useState('')
  const [defaultInterestRate, setDefaultInterestRate] = useState('')
  const [penaltyRate, setPenaltyRate] = useState('')
  const [penaltyGracePeriodHours, setPenaltyGracePeriodHours] = useState('')
  const [top3BonusPercentage, setTop3BonusPercentage] = useState('')
  const [top3RankingWeightAmount, setTop3RankingWeightAmount] = useState('')
  const [top3RankingWeightCount, setTop3RankingWeightCount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    apiFetch<Config>('/config', idToken)
      .then((data) => {
        if (cancelled) return
        setConfig(data)
        setShareValue(String(data.share_value))
        setMaxShares(String(data.max_shares_per_member))
        setDefaultInterestRate(String(data.default_interest_rate))
        setPenaltyRate(String(data.penalty_rate))
        setPenaltyGracePeriodHours(String(data.penalty_grace_period_hours))
        setTop3BonusPercentage(String(data.top3_bonus_percentage))
        setTop3RankingWeightAmount(String(data.top3_ranking_weight_amount))
        setTop3RankingWeightCount(String(data.top3_ranking_weight_count))
      })
      .catch(() => {
        if (!cancelled) setError('Could not load settings.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!idToken) return
    setSaveError(null)
    setSaved(false)
    try {
      const updated = await apiFetch<Config>('/config', idToken, {
        method: 'PUT',
        body: {
          share_value: Number(shareValue),
          max_shares_per_member: Number(maxShares),
          default_interest_rate: Number(defaultInterestRate),
          penalty_rate: Number(penaltyRate),
          penalty_grace_period_hours: Number(penaltyGracePeriodHours),
          top3_bonus_percentage: Number(top3BonusPercentage),
          top3_ranking_weight_amount: Number(top3RankingWeightAmount),
          top3_ranking_weight_count: Number(top3RankingWeightCount),
        },
      })
      setConfig(updated)
      setSaved(true)
    } catch {
      setSaveError('Could not save settings.')
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!config) {
    return <p>Loading...</p>
  }

  return (
    <div>
      <h1>Settings</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="share-value">Share value</label>
        <input
          id="share-value"
          type="number"
          value={shareValue}
          onChange={(e) => setShareValue(e.target.value)}
          required
        />
        <label htmlFor="max-shares">Max shares per member</label>
        <input
          id="max-shares"
          type="number"
          value={maxShares}
          onChange={(e) => setMaxShares(e.target.value)}
          required
        />
        <label htmlFor="default-interest-rate">Default interest rate</label>
        <input
          id="default-interest-rate"
          type="number"
          step="0.01"
          value={defaultInterestRate}
          onChange={(e) => setDefaultInterestRate(e.target.value)}
          required
        />
        <label htmlFor="penalty-rate">Penalty rate</label>
        <input
          id="penalty-rate"
          type="number"
          step="0.01"
          value={penaltyRate}
          onChange={(e) => setPenaltyRate(e.target.value)}
          required
        />
        <label htmlFor="penalty-grace-period-hours">Penalty grace period (hours)</label>
        <input
          id="penalty-grace-period-hours"
          type="number"
          value={penaltyGracePeriodHours}
          onChange={(e) => setPenaltyGracePeriodHours(e.target.value)}
          required
        />
        <label htmlFor="top3-bonus-percentage">Top 3 bonus percentage</label>
        <input
          id="top3-bonus-percentage"
          type="number"
          step="0.01"
          value={top3BonusPercentage}
          onChange={(e) => setTop3BonusPercentage(e.target.value)}
          required
        />
        <label htmlFor="top3-ranking-weight-amount">Top 3 ranking weight (amount)</label>
        <input
          id="top3-ranking-weight-amount"
          type="number"
          step="0.01"
          value={top3RankingWeightAmount}
          onChange={(e) => setTop3RankingWeightAmount(e.target.value)}
          required
        />
        <label htmlFor="top3-ranking-weight-count">Top 3 ranking weight (count)</label>
        <input
          id="top3-ranking-weight-count"
          type="number"
          step="0.01"
          value={top3RankingWeightCount}
          onChange={(e) => setTop3RankingWeightCount(e.target.value)}
          required
        />
        {saveError && <p role="alert">{saveError}</p>}
        {saved && <p>Settings saved.</p>}
        <button type="submit">Save</button>
      </form>
    </div>
  )
}
