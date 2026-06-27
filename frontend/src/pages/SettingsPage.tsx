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

  if (error)
    return (
      <p
        role="alert"
        className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm"
      >
        {error}
      </p>
    )

  if (!config)
    return (
      <div className="motion-safe:animate-pulse space-y-3">
        <div className="h-6 bg-white/10 rounded w-1/4" />
        <div className="h-64 bg-white/10 rounded-xl" />
      </div>
    )

  const inputClass =
    'w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150'
  const labelClass = 'block text-xs font-medium text-slate-400 mb-1'

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-50 mb-6">Settings</h1>
      <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6 max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Share settings */}
          <h2 className="text-base font-semibold text-slate-300">Share settings</h2>
          <div>
            <label htmlFor="share-value" className={labelClass}>
              Share value
            </label>
            <input
              id="share-value"
              type="number"
              value={shareValue}
              onChange={(e) => setShareValue(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="max-shares" className={labelClass}>
              Max shares per member
            </label>
            <input
              id="max-shares"
              type="number"
              value={maxShares}
              onChange={(e) => setMaxShares(e.target.value)}
              required
              className={inputClass}
            />
          </div>

          <hr className="border-white/[0.08] my-6" />

          {/* Loan settings */}
          <h2 className="text-base font-semibold text-slate-300">Loan settings</h2>
          <div>
            <label htmlFor="default-interest-rate" className={labelClass}>
              Default interest rate
            </label>
            <input
              id="default-interest-rate"
              type="number"
              step="0.01"
              value={defaultInterestRate}
              onChange={(e) => setDefaultInterestRate(e.target.value)}
              required
              className={inputClass}
            />
          </div>

          <hr className="border-white/[0.08] my-6" />

          {/* Penalty settings */}
          <h2 className="text-base font-semibold text-slate-300">Penalty settings</h2>
          <div>
            <label htmlFor="penalty-rate" className={labelClass}>
              Penalty rate
            </label>
            <input
              id="penalty-rate"
              type="number"
              step="0.01"
              value={penaltyRate}
              onChange={(e) => setPenaltyRate(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="penalty-grace-period-hours" className={labelClass}>
              Penalty grace period (hours)
            </label>
            <input
              id="penalty-grace-period-hours"
              type="number"
              value={penaltyGracePeriodHours}
              onChange={(e) => setPenaltyGracePeriodHours(e.target.value)}
              required
              className={inputClass}
            />
          </div>

          <hr className="border-white/[0.08] my-6" />

          {/* Top 3 ranking */}
          <h2 className="text-base font-semibold text-slate-300">Top 3 ranking</h2>
          <div>
            <label htmlFor="top3-bonus-percentage" className={labelClass}>
              Top 3 bonus percentage
            </label>
            <input
              id="top3-bonus-percentage"
              type="number"
              step="0.01"
              value={top3BonusPercentage}
              onChange={(e) => setTop3BonusPercentage(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="top3-ranking-weight-amount" className={labelClass}>
              Top 3 ranking weight (amount)
            </label>
            <input
              id="top3-ranking-weight-amount"
              type="number"
              step="0.01"
              value={top3RankingWeightAmount}
              onChange={(e) => setTop3RankingWeightAmount(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="top3-ranking-weight-count" className={labelClass}>
              Top 3 ranking weight (count)
            </label>
            <input
              id="top3-ranking-weight-count"
              type="number"
              step="0.01"
              value={top3RankingWeightCount}
              onChange={(e) => setTop3RankingWeightCount(e.target.value)}
              required
              className={inputClass}
            />
          </div>

          {saveError && (
            <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
              {saveError}
            </p>
          )}
          {saved && (
            <p className="bg-green-500/10 border border-green-500/20 text-green-300 rounded-lg px-4 py-3 text-sm">
              Settings saved.
            </p>
          )}

          <div className="pt-2">
            <button
              type="submit"
              className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
