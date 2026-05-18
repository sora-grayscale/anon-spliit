'use client'

import { useCurrentGroup } from '@/app/groups/[groupId]/current-group-context'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/use-toast'
import {
  buildCsvFromGroup,
  buildJsonFromGroup,
  type ExportExpense,
  type ExportGroup,
} from '@/lib/export'
import { useAllGroupExpenses } from '@/lib/hooks'
import { Download, FileDown, FileJson } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export default function ExportButton({ groupId }: { groupId: string }) {
  const t = useTranslations('Expenses')
  const { toast } = useToast()
  const currentGroup = useCurrentGroup()
  const [isExporting, setIsExporting] = useState(false)

  // enabled:false + autoDrain:false — no fetch happens on render. The full
  // drain runs only when the user clicks an export item (Issue #170).
  const { fetchAll } = useAllGroupExpenses(groupId, {
    enabled: false,
    autoDrain: false,
  })

  async function handleExport(format: 'csv' | 'json') {
    if (currentGroup.isLoading) {
      toast({
        description: 'Export data is not ready yet. Please try again shortly.',
        variant: 'destructive',
      })
      return
    }
    setIsExporting(true)
    try {
      // Use the RETURN VALUE of fetchAll (not the hook's React state) so this
      // closure cannot read a stale `expenses` snapshot.
      const decrypted = await fetchAll()
      const group = currentGroup.group as unknown as ExportGroup
      const expenses = decrypted as unknown as ExportExpense[]
      const date = new Date().toISOString().split('T')[0]
      const filenameBase = `Spliit Export - ${group.name} - ${date}`
      if (format === 'csv') {
        const csv = buildCsvFromGroup(group, expenses)
        // ﻿ prepends a UTF-8 BOM so spreadsheet apps recognize encoding.
        downloadBlob(`﻿${csv}`, `${filenameBase}.csv`, 'text/csv;charset=utf-8')
      } else {
        const json = buildJsonFromGroup(group, expenses)
        downloadBlob(json, `${filenameBase}.json`, 'application/json')
      }
    } catch (error) {
      console.error('Export failed:', error)
      toast({
        description:
          error instanceof Error && error.message
            ? `Export failed: ${error.message}`
            : 'Export failed. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          title={t('export')}
          variant="secondary"
          size="icon"
          disabled={isExporting}
        >
          <Download className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          onClick={() => handleExport('json')}
          disabled={isExporting}
        >
          <div className="flex items-center gap-2">
            <FileJson className="w-4 h-4" />
            <p>{t('exportJson')}</p>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleExport('csv')}
          disabled={isExporting}
        >
          <div className="flex items-center gap-2">
            <FileDown className="w-4 h-4" />
            <p>{t('exportCsv')}</p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
