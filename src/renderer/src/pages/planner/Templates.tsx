// Vorlagen im Planer: einen Plan unter einem Namen speichern, wieder laden und löschen.
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { tr } from '@shared/i18n'
import type { TemplateDto } from '@shared/ipc'
import { api } from '../../api'
import Knopf from '../../components/bausteine/Knopf'
import Auswahl from '../../components/bausteine/Auswahl'

export function useTemplates({ current, onApply }: { current: () => Omit<TemplateDto, 'id' | 'name'> | null; onApply: (t: TemplateDto) => void }) {
  const [templates, setTemplates] = useState<TemplateDto[]>([])
  const [templateId, setTemplateId] = useState('')
  /** Name im Speichern-Fenster, null = Fenster zu */
  const [saveAs, setSaveAs] = useState<string | null>(null)
  useEffect(() => { api().templates().then(setTemplates).catch(() => setTemplates([])) }, [])

  function apply(id: string) {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (t) onApply(t)
  }
  async function store(name: string) {
    const cur = current()
    if (!cur || !name.trim()) return
    const t: TemplateDto = { id: String(Date.now()), name: name.trim(), ...cur }
    await api().saveTemplate(t)
    setTemplates(await api().templates())
    setTemplateId(t.id)
    setSaveAs(null)
  }
  async function remove() {
    if (!templateId) return
    await api().deleteTemplate(templateId)
    setTemplates(await api().templates())
    setTemplateId('')
  }
  return {
    templates, templateId, saveAs, apply, store, remove,
    openSave: () => setSaveAs(templateId ? templates.find((t) => t.id === templateId)?.name ?? '' : ''),
    closeSave: () => setSaveAs(null),
  }
}

export function TemplatePicker({ templates, templateId, apply, remove }: Pick<ReturnType<typeof useTemplates>, 'templates' | 'templateId' | 'apply' | 'remove'>): JSX.Element | null {
  if (!templates.length) return null
  return (
    <label className="block">
      <span className="label">{tr('Vorlage', 'Template')}</span>
      <span className="flex gap-2">
        <Auswahl className="w-full" value={templateId} onChange={(e) => apply(e.target.value)}>
          <option value="">{tr('Keine Vorlage', 'No template')}</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.pairName}</option>)}
        </Auswahl>
        {templateId && <Knopf art="leise" nurSymbol symbol={Trash2} className="flex-shrink-0" onClick={remove} aria-label={tr('Vorlage löschen', 'Delete template')} title={tr('Vorlage löschen', 'Delete template')} />}
      </span>
    </label>
  )
}
