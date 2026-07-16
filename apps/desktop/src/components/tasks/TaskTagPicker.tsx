import { Tags } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Tag } from "../../domain";

export function TaskTagPicker({ tags, selectedIds, onChange, onCreate }: { tags: Tag[]; selectedIds: string[]; onChange(ids: string[]): void; onCreate(name: string): Promise<Tag> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const cleanQuery = query.trim();
  const canCreate = cleanQuery.length > 0 && !tags.some((tag) => tag.name.toLocaleLowerCase() === cleanQuery.toLocaleLowerCase());
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline"><Tags data-icon="inline-start" />タグ {selectedIds.length > 0 ? selectedIds.length : ""}</Button>
      </PopoverTrigger>
      <PopoverContent className="task-command-popover" align="start">
        <Command>
          <CommandInput placeholder="タグを検索…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>見つかりません</CommandEmpty>
            <CommandGroup>
              {canCreate ? <CommandItem value={`create-${cleanQuery}`} onSelect={() => { void onCreate(cleanQuery).then((tag) => { onChange([...selectedIds, tag.id]); setQuery(""); }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "タグを作成できませんでした")); }}>「{cleanQuery}」を作成</CommandItem> : null}
              {tags.map((tag) => {
                const checked = selectedIds.includes(tag.id);
                return <CommandItem key={tag.id} value={tag.name} data-checked={checked} onSelect={() => onChange(checked ? selectedIds.filter((id) => id !== tag.id) : [...selectedIds, tag.id])}>{tag.name}</CommandItem>;
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
