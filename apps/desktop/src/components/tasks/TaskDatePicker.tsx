import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { CalendarDays, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function dateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function TaskDatePicker({ label, value, taskTitle, onChange }: {
  label: string;
  value: string | null;
  taskTitle?: string;
  onChange(value: string | null): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className="task-field-button task-date-button" variant="ghost" aria-label={taskTitle ? `${taskTitle}の${label}` : label}>
          <CalendarDays data-icon="inline-start" />
          <span>{value ? format(parseISO(value), "M月d日", { locale: ja }) : label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="task-date-popover" align="end">
        <Calendar
          mode="single"
          locale={ja}
          selected={value ? parseISO(value) : undefined}
          onSelect={(date) => {
            if (!date) return;
            onChange(dateKey(date));
            setOpen(false);
          }}
        />
        {value ? <Button variant="ghost" className="task-clear-date" onClick={() => { onChange(null); setOpen(false); }}><X data-icon="inline-start" />日付を外す</Button> : null}
      </PopoverContent>
    </Popover>
  );
}
