import { useMemo, useState } from "react";
import {
  Code2Icon,
  Disc3Icon,
  EllipsisIcon,
  HeartIcon,
  ListMusicIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import type { MusicTrack, MusicTrackListQuery, MusicTrackSort, MusicStructureFamily } from "../domain";
import { MOOD_BY_ID } from "../services/moodCatalog";
import { useLyra } from "../state/LyraContext";
import { PageHeader, Screen } from "../ui/components";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import "./LibraryScreen.css";

const STRUCTURE_LABELS: Record<MusicStructureFamily, string> = {
  ambient: "Ambient",
  lofi: "Lo-fi",
  "minimal-melody": "Minimal melody",
  "organic-pulse": "Organic pulse",
  downtempo: "Downtempo",
  neoclassical: "Neoclassical",
};

const STRUCTURE_OPTIONS = Object.entries(STRUCTURE_LABELS) as Array<[MusicStructureFamily, string]>;

export function prepareBulkDeleteIds(ids: string[]): string[] {
  const unique = [...new Set(ids)];
  if (unique.length > 200) throw new Error("一度に削除できるのは200曲までです");
  return unique;
}

function recipeMoods(track: MusicTrack): Array<{ label: string; image: string }> {
  if (!track.recipeJson) return [];
  try {
    const parsed = JSON.parse(track.recipeJson) as { moods?: Array<{ moodId?: string }> };
    return (parsed.moods ?? []).flatMap(({ moodId }) => {
      const mood = moodId ? MOOD_BY_ID.get(moodId) : undefined;
      return mood ? [{ label: mood.label, image: mood.image }] : [];
    });
  } catch {
    return [];
  }
}

function recipeSummary(track: MusicTrack): string {
  const moods = recipeMoods(track).map(({ label }) => label);
  return moods.length > 0 ? moods.join(" + ") : STRUCTURE_LABELS[track.structureFamily ?? track.arrangement];
}

function trackThumbnail(track: MusicTrack): string {
  return recipeMoods(track)[0]?.image ?? "/moods/scene-quiet-library.webp";
}

function sortTracks(tracks: MusicTrack[], sort: MusicTrackSort): MusicTrack[] {
  return [...tracks].sort((left, right) => {
    switch (sort) {
      case "created_asc": return left.createdAt.localeCompare(right.createdAt);
      case "title_asc": return left.title.localeCompare(right.title, "ja");
      case "title_desc": return right.title.localeCompare(left.title, "ja");
      case "bpm_asc": return left.bpm - right.bpm;
      case "bpm_desc": return right.bpm - left.bpm;
      case "created_desc": return right.createdAt.localeCompare(left.createdAt);
    }
  });
}

interface QueryControls {
  search: string;
  favorite: "all" | "favorite";
  structure: "all" | MusicStructureFamily;
  sort: MusicTrackSort;
}

function toLibraryQuery(controls: QueryControls): MusicTrackListQuery {
  return {
    query: controls.search.trim() || undefined,
    favorite: controls.favorite === "favorite" ? true : undefined,
    structureFamily: controls.structure === "all" ? undefined : controls.structure,
    sort: controls.sort,
  };
}

export function LibraryScreen() {
  const {
    tracks: catalogTracks,
    libraryTracks: tracks,
    libraryQuery,
    musicPlayback,
    selectedTrackId,
    settings,
    setLibraryQuery,
    renameTrack,
    deleteTracks,
    previewTrack,
    stopMusic,
    pauseMusic,
    resumeMusic,
    selectTrack,
    saveSettings,
    toggleFavorite,
    loadTrackSource,
  } = useLyra();
  const initialStructure = libraryQuery.structureFamily;
  const [controls, setControls] = useState<QueryControls>({
    search: libraryQuery.query ?? "",
    favorite: libraryQuery.favorite ? "favorite" : "all",
    structure: STRUCTURE_OPTIONS.some(([value]) => value === initialStructure) ? initialStructure as MusicStructureFamily : "all",
    sort: libraryQuery.sort ?? "created_desc",
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [playerTrackId, setPlayerTrackId] = useState<string | null>(() => selectedTrackId ?? musicPlayback.trackId ?? catalogTracks[0]?.id ?? null);
  const [pausedByPlayer, setPausedByPlayer] = useState(false);
  const [sourceTrack, setSourceTrack] = useState<MusicTrack | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const visibleTracks = useMemo(() => {
    const term = controls.search.trim().toLocaleLowerCase("ja");
    return sortTracks(tracks.filter((track) => {
      if (term && !`${track.title} ${track.description}`.toLocaleLowerCase("ja").includes(term)) return false;
      if (controls.favorite === "favorite" && !track.favorite) return false;
      if (controls.structure !== "all" && (track.structureFamily ?? track.arrangement) !== controls.structure) return false;
      return true;
    }), controls.sort);
  }, [controls, tracks]);

  const selected = useMemo(() => [...selectedIds].filter((id) => tracks.some((track) => track.id === id)), [selectedIds, tracks]);
  const visibleIds = useMemo(() => visibleTracks.map((track) => track.id), [visibleTracks]);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const playerTrack = catalogTracks.find((track) => track.id === musicPlayback.trackId)
    ?? catalogTracks.find((track) => track.id === playerTrackId)
    ?? catalogTracks[0]
    ?? null;
  const isPlayerTrackPlaying = Boolean(playerTrack && musicPlayback.status === "playing" && musicPlayback.trackId === playerTrack.id);

  function updateControls(next: Partial<QueryControls>) {
    const updated = { ...controls, ...next };
    setControls(updated);
    setSelectedIds(new Set());
    void setLibraryQuery(toLibraryQuery(updated)).catch((reason) => {
      toast.error(reason instanceof Error ? reason.message : "ライブラリを更新できませんでした");
    });
  }

  function toggleVisibleSelection(checked: boolean | "indeterminate") {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) checked === true ? next.add(id) : next.delete(id);
      return next;
    });
  }

  function toggleTrackSelection(id: string, checked: boolean | "indeterminate") {
    setSelectedIds((current) => {
      const next = new Set(current);
      checked === true ? next.add(id) : next.delete(id);
      return next;
    });
  }

  function beginRename(track: MusicTrack) {
    setEditingId(track.id);
    setEditingTitle(track.title);
    setTitleError(null);
  }

  async function commitRename(track: MusicTrack) {
    const title = editingTitle.trim();
    if (title.length < 1 || title.length > 100) {
      setTitleError("曲名は1〜100文字で入力してください");
      return;
    }
    try {
      await renameTrack(track.id, title);
      setEditingId(null);
      setTitleError(null);
      toast.success("曲名を変更しました");
    } catch (reason) {
      setTitleError(reason instanceof Error ? reason.message : "曲名を変更できませんでした");
    }
  }

  function requestDelete() {
    try {
      const ids = prepareBulkDeleteIds(selected);
      if (ids.length === 0) return;
      setDeleteIds(ids);
      setDeleteOpen(true);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "曲を削除できませんでした");
    }
  }

  async function confirmDelete() {
    setIsDeleting(true);
    try {
      const result = await deleteTracks(deleteIds);
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of result.deletedIds) next.delete(id);
        return next;
      });
      setDeleteOpen(false);
      toast.success(`${result.deletedIds.length}曲を削除しました`);
      if (result.unlinkedChildIds.length > 0) toast.info("残した派生曲の親曲リンクを解除しました");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "曲を削除できませんでした");
    } finally {
      setIsDeleting(false);
    }
  }

  async function play(track: MusicTrack) {
    setPlayerTrackId(track.id);
    setPausedByPlayer(false);
    try {
      await previewTrack(track.id);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "曲を再生できませんでした");
    }
  }

  async function togglePlayerPlayback() {
    if (!playerTrack) return;
    if (isPlayerTrackPlaying) {
      await pauseMusic();
      setPausedByPlayer(true);
      return;
    }
    if (pausedByPlayer && musicPlayback.trackId === playerTrack.id) {
      await resumeMusic();
      setPausedByPlayer(false);
      return;
    }
    await play(playerTrack);
  }

  async function showSource(track: MusicTrack) {
    setSourceTrack(track);
    setSource(null);
    try {
      setSource(await loadTrackSource(track.id));
    } catch {
      setSource("ChucKソースの整合性を確認できませんでした。");
    }
  }

  return (
    <Screen className="library-screen">
      <PageHeader eyebrow="YOUR SOUND ARCHIVE" title="ライブラリ" />

      <section className="library-controls" aria-label="ライブラリの絞り込み">
        <InputGroup className="library-search">
          <InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="曲を検索"
            placeholder="曲名や説明を検索"
            value={controls.search}
            onChange={(event) => updateControls({ search: event.currentTarget.value })}
          />
        </InputGroup>
        <Select value={controls.favorite} onValueChange={(value) => updateControls({ favorite: value as QueryControls["favorite"] })}>
          <SelectTrigger aria-label="お気に入りで絞り込み"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="all">すべての曲</SelectItem>
            <SelectItem value="favorite">お気に入り</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
        <Select value={controls.structure} onValueChange={(value) => updateControls({ structure: value as QueryControls["structure"] })}>
          <SelectTrigger aria-label="構成で絞り込み"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="all">すべての構成</SelectItem>
            {STRUCTURE_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
        <Select value={controls.sort} onValueChange={(value) => updateControls({ sort: value as MusicTrackSort })}>
          <SelectTrigger aria-label="曲を並べ替え"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="created_desc">新しい順</SelectItem>
            <SelectItem value="created_asc">古い順</SelectItem>
            <SelectItem value="title_asc">曲名 A–Z</SelectItem>
            <SelectItem value="title_desc">曲名 Z–A</SelectItem>
            <SelectItem value="bpm_asc">BPMが遅い順</SelectItem>
            <SelectItem value="bpm_desc">BPMが速い順</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
      </section>

      {selected.length > 0 ? (
        <section className="library-selection-toolbar" aria-label="選択した曲の操作">
          <strong>{selected.length}曲を選択中</strong>
          <span>現在の検索結果から選択しています</span>
          <Button variant="destructive" onClick={requestDelete}>
            <Trash2Icon data-icon="inline-start" />選択した曲を削除
          </Button>
        </section>
      ) : null}

      <section className="library-table-region" aria-label="保存した曲">
        {visibleTracks.length === 0 ? (
          <Empty className="library-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon"><ListMusicIcon /></EmptyMedia>
              <EmptyTitle>{catalogTracks.length === 0 ? "まだ保存曲がありません" : "条件に合う曲がありません"}</EmptyTitle>
              <EmptyDescription>{catalogTracks.length === 0 ? "Music Alchemyで音楽を融合し、検証後に保存するとここへ並びます。" : "検索語やフィルタを変えてください。"}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="library-check-cell">
                  <Checkbox
                    aria-label="検索結果をすべて選択"
                    checked={allVisibleSelected ? true : selectedVisibleCount > 0 ? "indeterminate" : false}
                    onCheckedChange={toggleVisibleSelection}
                  />
                </TableHead>
                <TableHead>曲</TableHead>
                <TableHead>レシピ</TableHead>
                <TableHead>BPM</TableHead>
                <TableHead>作成日</TableHead>
                <TableHead><span className="sr-only">操作</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleTracks.map((track) => {
                const structure = track.structureFamily ?? track.arrangement;
                const parent = track.parentTrackId ? catalogTracks.find((candidate) => candidate.id === track.parentTrackId) : null;
                return (
                  <TableRow key={track.id} data-state={selectedIds.has(track.id) ? "selected" : undefined} className="library-track-row">
                    <TableCell className="library-check-cell">
                      <Checkbox
                        aria-label={`${track.title}を選択`}
                        checked={selectedIds.has(track.id)}
                        onCheckedChange={(checked) => toggleTrackSelection(track.id, checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="library-track-identity">
                        <button type="button" className="library-artwork" aria-label={`再生: ${track.title}`} onClick={() => void play(track)}>
                          <img src={trackThumbnail(track)} alt="" />
                          <PlayIcon aria-hidden="true" />
                        </button>
                        <div className="library-title-stack">
                          {editingId === track.id ? (
                            <div className="library-title-editor">
                              <Input
                                autoFocus
                                aria-label={`${track.title}の新しい曲名`}
                                aria-invalid={Boolean(titleError)}
                                value={editingTitle}
                                onChange={(event) => { setEditingTitle(event.currentTarget.value); setTitleError(null); }}
                                onBlur={() => { setEditingId(null); setTitleError(null); }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") { event.preventDefault(); void commitRename(track); }
                                  if (event.key === "Escape") { event.preventDefault(); setEditingId(null); setTitleError(null); }
                                }}
                              />
                              {titleError ? <span role="alert">{titleError}</span> : null}
                            </div>
                          ) : (
                            <button type="button" className="library-title-button" aria-label={`曲名を変更: ${track.title}`} onClick={() => beginRename(track)}>
                              {track.title}
                            </button>
                          )}
                          <span>{parent ? `${parent.title} の派生曲` : track.description}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><div className="library-recipe"><Badge variant="secondary">{STRUCTURE_LABELS[structure]}</Badge><span>{recipeSummary(track)}</span></div></TableCell>
                    <TableCell>{track.bpm}</TableCell>
                    <TableCell>{new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(new Date(track.createdAt))}</TableCell>
                    <TableCell className="library-actions-cell">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={track.favorite ? `${track.title}をお気に入りから外す` : `${track.title}をお気に入りに追加`}
                        onClick={() => void toggleFavorite(track.id)}
                      >
                        <HeartIcon data-filled={track.favorite ? "true" : undefined} />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={`${track.title}のその他の操作`}><EllipsisIcon /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end"><DropdownMenuGroup>
                          <DropdownMenuItem onSelect={() => beginRename(track)}>曲名を変更</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void showSource(track)}><Code2Icon />ChucKコード</DropdownMenuItem>
                        </DropdownMenuGroup></DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <footer className="library-player" aria-label="WebChucKプレイヤー">
        {playerTrack ? (
          <>
            <img src={trackThumbnail(playerTrack)} alt="" className="library-player-art" />
            <div className="library-player-copy">
              <span>NOW IN THE ALCHEMY DECK</span>
              <strong>{playerTrack.title}</strong>
              <small>{recipeSummary(playerTrack)}</small>
            </div>
            <div className="library-player-buttons">
              <Button type="button" variant="outline" size="icon" aria-label={isPlayerTrackPlaying ? "一時停止" : pausedByPlayer ? "再開" : "再生"} onClick={() => void togglePlayerPlayback()}>
                {isPlayerTrackPlaying ? <PauseIcon /> : <PlayIcon />}
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="停止" onClick={() => { setPausedByPlayer(false); void stopMusic(); }}><SquareIcon /></Button>
            </div>
            <div className="library-volume">
              <span>音量</span>
              <Slider
                aria-label="マスター音量"
                min={0}
                max={100}
                value={[Math.round(settings.masterVolume * 100)]}
                onValueCommit={([value]) => void saveSettings({ ...settings, masterVolume: value / 100 })}
              />
            </div>
            <Button type="button" variant="secondary" onClick={() => { void selectTrack(playerTrack.id); toast.success("集中時の曲に設定しました"); }}>
              <Disc3Icon data-icon="inline-start" />集中で使う
            </Button>
          </>
        ) : <span className="library-player-empty">保存した曲を選ぶと、ここから再生できます。</span>}
      </footer>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>選択した{deleteIds.length}曲を完全に削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>.ckファイルも削除されます。この操作は取り消せません。残した派生曲はそのまま利用できます。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>キャンセル</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isDeleting} onClick={() => void confirmDelete()}>完全に削除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(sourceTrack)} onOpenChange={(open) => { if (!open) { setSourceTrack(null); setSource(null); } }}>
        <DialogContent className="library-source-dialog">
          <DialogHeader>
            <DialogTitle>{sourceTrack?.title ?? "曲"} — ChucK</DialogTitle>
            <DialogDescription>保存済みSHA-256と照合した読み取り専用ソースです。</DialogDescription>
          </DialogHeader>
          <pre>{source ?? "検証済みソースを読み込み中…"}</pre>
          {sourceTrack ? <small>{sourceTrack.sourcePath} · SHA-256 {sourceTrack.sourceSha256}</small> : null}
        </DialogContent>
      </Dialog>
    </Screen>
  );
}
