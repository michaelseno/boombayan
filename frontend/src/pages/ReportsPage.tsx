import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'

type TabId = 'portfolio' | 'cycles' | 'members' | 'loans'

const TABS: { id: TabId; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'cycles', label: 'Cycles' },
  { id: 'members', label: 'Members' },
  { id: 'loans', label: 'Loans' },
]

const disabledBtnClass =
  'opacity-50 cursor-not-allowed bg-white/[0.08] border border-white/10 text-slate-400 px-4 py-2 rounded-lg text-sm'

export function ReportsPage() {
  const { idToken: _idToken } = useAuth()
  const [activeTab, setActiveTab] = useState<TabId>('portfolio')

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-50 mb-6">Reports</h1>

      {/* Tab bar */}
      <div role="tablist" className="flex gap-1 border-b border-white/[0.08] mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors duration-150 border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels — placeholder content */}
      <div className="min-h-[200px]">
        {activeTab === 'portfolio' && <div>Portfolio content coming soon</div>}
        {activeTab === 'cycles' && <div>Cycles content coming soon</div>}
        {activeTab === 'members' && <div>Members content coming soon</div>}
        {activeTab === 'loans' && <div>Loans content coming soon</div>}
      </div>

      {/* Download buttons — disabled placeholders */}
      <div className="flex gap-3 mt-8">
        <button disabled aria-disabled="true" className={disabledBtnClass}>
          Download PDF
        </button>
        <button disabled aria-disabled="true" className={disabledBtnClass}>
          Download CSV
        </button>
      </div>
    </div>
  )
}
