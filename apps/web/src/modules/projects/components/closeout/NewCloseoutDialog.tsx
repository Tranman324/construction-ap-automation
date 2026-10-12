'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/modules/shared/components/ui/dialog';
import { Button } from '@/modules/shared/components/ui/button';
import { Input } from '@/modules/shared/components/ui/input';
import { Checkbox } from '@/modules/shared/components/ui/checkbox';
import { Plus } from 'lucide-react';
import { MASTER_TRADES } from '@/modules/projects/mock/trades';
import { useUsers } from '@/modules/projects/hooks/queries';
import { useCreateCloseoutProject } from '@/modules/projects/hooks/mutations';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/shared/components/ui/select';

export function NewCloseoutDialog() {
  const [open, setOpen] = useState(false);
  const [jobNumber, setJobNumber] = useState('');
  const [jobName, setJobName] = useState('');
  const [pmId, setPmId] = useState('');
  const [selectedTrades, setSelectedTrades] = useState<string[]>([]);

  const { data: users } = useUsers();
  const createCloseout = useCreateCloseoutProject();

  const pms = users?.filter((u) => u.role.name === 'pm') ?? [];

  const toggleTrade = (tradeId: string) => {
    setSelectedTrades((prev) =>
      prev.includes(tradeId) ? prev.filter((id) => id !== tradeId) : [...prev, tradeId],
    );
  };

  const handleCreate = () => {
    if (!jobNumber.trim() || !jobName.trim() || !pmId || selectedTrades.length === 0) return;
    createCloseout.mutate(
      { projectId: null, jobNumber: jobNumber.trim(), jobName: jobName.trim(), pmId, tradeIds: selectedTrades },
      { onSuccess: () => { setOpen(false); reset(); } },
    );
  };

  const reset = () => {
    setJobNumber('');
    setJobName('');
    setPmId('');
    setSelectedTrades([]);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" /> New Closeout
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Closeout Project</DialogTitle>
          <DialogDescription>Create a new closeout tracker for a project.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-[100px_1fr] items-center gap-2">
            <label className="text-xs font-medium text-right">Job #</label>
            <Input value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} placeholder="26-440" className="h-8 text-sm" />
          </div>
          <div className="grid grid-cols-[100px_1fr] items-center gap-2">
            <label className="text-xs font-medium text-right">Job Name</label>
            <Input value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="Project name" className="h-8 text-sm" />
          </div>
          <div className="grid grid-cols-[100px_1fr] items-center gap-2">
            <label className="text-xs font-medium text-right">PM</label>
            <Select value={pmId} onValueChange={setPmId}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select PM" />
              </SelectTrigger>
              <SelectContent>
                {pms.map((u: { id: string; name: string }) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[100px_1fr] items-start gap-2">
            <label className="text-xs font-medium text-right pt-1">Trades</label>
            <div className="grid grid-cols-2 gap-1">
              {MASTER_TRADES.map((t) => (
                <label key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted/40 cursor-pointer">
                  <Checkbox
                    checked={selectedTrades.includes(t.id)}
                    onCheckedChange={() => toggleTrade(t.id)}
                    className="size-3"
                  />
                  <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreate}
            disabled={!jobNumber.trim() || !jobName.trim() || !pmId || selectedTrades.length === 0}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
