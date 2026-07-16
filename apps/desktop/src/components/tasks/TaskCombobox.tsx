import { FolderKanban } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type ComboboxItem = { id: string; name: string };

export function TaskCombobox({ label, value, items, taskTitle, onChange }: {
  label: string;
  value: string | null;
  items: ComboboxItem[];
  taskTitle?: string;
  onChange(value: string | null): void;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className="task-field-button" variant="ghost" aria-label={taskTitle ? `${taskTitle}の${label}` : label}>
          <FolderKanban data-icon="inline-start" /><span>{selected?.name ?? label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="task-command-popover" align="start">
        <Command>
          <CommandInput placeholder={`${label}を検索…`} />
          <CommandList>
            <CommandEmpty>見つかりません</CommandEmpty>
            <CommandGroup>
              <CommandItem value="なし" data-checked={value === null} onSelect={() => { onChange(null); setOpen(false); }}>なし</CommandItem>
              {items.map((item) => (
                <CommandItem key={item.id} value={item.name} data-checked={value === item.id} onSelect={() => { onChange(item.id); setOpen(false); }}>{item.name}</CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
