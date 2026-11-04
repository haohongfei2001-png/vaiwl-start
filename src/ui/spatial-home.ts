import type { ConversationRecord } from '../../contracts/free-v1.js';
import { element as el, icon, button } from './dom.js';
import type { RecentDisplayGroup } from './recent-groups.js';
import type { HomeTheme } from '../domain/home-theme.js';
import { selectRecentPresentation } from '../domain/recent-presentation.js';

/** A presentation of the existing projection, never a second catalog or membership model. */
export interface SpatialCard {
  project: { key: string; nativeTitle: string | null; canonicalUrl: string };
  recent: ConversationRecord[];
  older: ConversationRecord[];
  undated: ConversationRecord[];
  attributes?: Record<string, string>;
}
export interface SpatialView {
  expandedProject: string | null;
  projectsCollapsed: boolean;
  collapsedDates: string[];
  dateLimits: Record<string, number>;
  projectLimits?: Record<string, number>;
}
const VIEW_KEY = 'vaiwl-start-spatial-view/1';
export const SPATIAL_PREVIEW_ROWS = 4;
export const SPATIAL_DATE_ROWS = 9;
export const SPATIAL_DATE_STEP = 24;
export const SPATIAL_PROJECT_ROWS = 24;
export const SPATIAL_PROJECT_STEP = 48;

export function readSpatialView(): SpatialView {
  const empty: SpatialView = { expandedProject: null, projectsCollapsed: false, collapsedDates: [], dateLimits: {} };
  try {
    const raw = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return empty;
    const projectLimits = raw.projectLimits && typeof raw.projectLimits === 'object' ? Object.fromEntries(Object.entries(raw.projectLimits)
      .filter(([key, value]) => key.length <= 500 && Number.isSafeInteger(value) && Number(value) >= SPATIAL_PROJECT_ROWS && Number(value) <= 10000)) as Record<string, number> : {};
    return {
      ...(Object.keys(projectLimits).length ? { projectLimits } : {}),
      expandedProject: typeof raw.expandedProject === 'string' && raw.expandedProject.length <= 500 ? raw.expandedProject : null,
      // The retired global collapse control must not hide previews in the shared layout.
      projectsCollapsed: false,
      collapsedDates: Array.isArray(raw.collapsedDates) ? raw.collapsedDates.filter((key: unknown) => typeof key === 'string' && key.length <= 500).slice(0, 500) : [],
      dateLimits: raw.dateLimits && typeof raw.dateLimits === 'object' ? Object.fromEntries(Object.entries(raw.dateLimits)
        .filter(([key, value]) => key.length <= 500 && Number.isSafeInteger(value) && Number(value) >= SPATIAL_DATE_ROWS && Number(value) <= 10000)) as Record<string, number> : {},
    };
  } catch { return empty; }
}
export function saveSpatialView(view: SpatialView): void {
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ ...view, projectsCollapsed: false })); } catch { /* View state is optional; no catalog mutation. */ }
}
/** Keep full-row expansion aligned with the visible theme grid, including B's side rail. */
export function spatialColumns(width: number, theme: HomeTheme = 'spatial'): number {
  if (theme === 'folio') return width <= 600 ? 1 : width <= 1050 ? 2 : 3;
  if (theme === 'workbench' && width > 1050) return width <= 1180 ? 2 : 3;
  return width <= 600 ? 1 : width <= 850 ? 2 : width <= 1180 ? 3 : 4;
}
export function spatialPanelId(key: string): string { return `spatial-expanded-${encodeURIComponent(key)}`; }

/** Preserve projected member order and every older/undated member, without duplicates. */
export function spatialMembers(card: SpatialCard): ConversationRecord[] {
  const seen = new Set<string>();
  return [...card.recent, ...card.older, ...card.undated].filter(record => {
    if (seen.has(record.key)) return false;
    seen.add(record.key); return true;
  });
}
type Row = (record: ConversationRecord) => HTMLElement;
export interface ProjectOptions { view: SpatialView; row: Row; columns: number; focusedRecord?: string | null }

export function spatialProjectGrid(cards: SpatialCard[], options: ProjectOptions): HTMLElement {
  const { view, row, focusedRecord } = options;
  view.projectsCollapsed = false;
  const grid = el('div', { class: 'project-grid spatial-project-grid' });
  if (focusedRecord) {
    const owner = cards.find(card => spatialMembers(card).some(record => record.key === focusedRecord));
    if (owner) {
      view.projectsCollapsed = false;
      const restIndex = spatialMembers(owner).findIndex(record => record.key === focusedRecord) - SPATIAL_PREVIEW_ROWS;
      if (restIndex >= 0) {
        view.expandedProject = owner.project.key;
        if (restIndex >= (view.projectLimits?.[owner.project.key] || SPATIAL_PROJECT_ROWS)) {
          (view.projectLimits ||= {})[owner.project.key] = SPATIAL_PROJECT_ROWS + Math.ceil((restIndex + 1 - SPATIAL_PROJECT_ROWS) / SPATIAL_PROJECT_STEP) * SPATIAL_PROJECT_STEP;
        }
      }
    }
  }
  const activeIndex = cards.findIndex(card => card.project.key === view.expandedProject && spatialMembers(card).length > SPATIAL_PREVIEW_ROWS);
  const columns = Math.max(1, Math.floor(options.columns));
  const after = activeIndex < 0 ? -1 : Math.min(cards.length - 1, (Math.floor(activeIndex / columns) + 1) * columns - 1);
  cards.forEach((card, index) => {
    const { project } = card, key = project.key, name = project.nativeTitle || '未命名项目';
    const members = spatialMembers(card), expanded = index === activeIndex;
    const titleId = `spatial-project-${encodeURIComponent(key)}`;
    const body = el('div', { class: 'project-body spatial-project-preview' }, [el('div', { class: 'conversation-list' }, members.slice(0, SPATIAL_PREVIEW_ROWS).map(row))]);
    if (!members.length) body.append(el('a', { class: 'empty-project-link', href: project.canonicalUrl }, ['打开项目', icon('external')]));
    const footer = el('div', { class: `spatial-project-footer${members.length <= SPATIAL_PREVIEW_ROWS ? ' is-complete' : ''}` });
    if (members.length > SPATIAL_PREVIEW_ROWS) footer.append(button(expanded ? '收起' : '展开更多', {
      class: 'spatial-expand', 'data-spatial-expand': key, 'data-focus-key': `spatial-expand:${key}`,
      'aria-expanded': String(expanded), 'aria-controls': spatialPanelId(key),
    }, 'down'));
    // Current collectors verify only a project landing URL, never a creation entry.
    // Keep the unavailable action discoverable without turning it into navigation.
    const creationExplanation = '暂不可用：尚未验证此项目的新对话入口，请打开项目后新建对话。';
    grid.append(el('article', { class: `project${expanded ? ' is-expanded' : ''}`, 'data-project': key, ...card.attributes, 'aria-labelledby': titleId }, [
      el('header', { class: 'project-head' }, [el('span', { class: 'project-symbol' }, [icon('folder')]),
        el('h3', { id: titleId, title: name }, [el('a', { class: 'spatial-project-name', href: project.canonicalUrl }, [name])]),
        button('', { class: 'icon-button project-create', 'data-project-create-unavailable': key, 'data-focus-key': `project-create:${key}`,
          'aria-disabled': 'true', title: creationExplanation, 'aria-label': `${name}：新建对话暂不可用，尚未验证项目内的新对话入口` }, 'plus')]), body, footer,
    ]));
    if (index === after) {
      const active = cards[activeIndex]!, activeName = active.project.nativeTitle || '未命名项目', rest = spatialMembers(active).slice(SPATIAL_PREVIEW_ROWS);
      const id = spatialPanelId(active.project.key), limit = view.projectLimits?.[active.project.key] || SPATIAL_PROJECT_ROWS;
      const panel = el('section', { class: 'spatial-project-expanded', id, 'data-expanded-project': active.project.key, role: 'region', 'aria-labelledby': `${id}-title` }, [
        el('div', { class: 'spatial-expanded-head' }, [
          el('div', {}, [el('h3', { id: `${id}-title`, tabindex: '-1' }, [activeName])]),
          el('div', { class: 'spatial-expanded-actions' }, [button('搜索此项目', { class: 'text-button', 'data-spatial-project-search': active.project.key }, 'search'),
            button('', { class: 'icon-button', 'data-spatial-expand': active.project.key, 'aria-label': `收起 ${activeName} 的会话`, 'data-focus-key': `spatial-close:${active.project.key}` }, 'close')]),
        ]), el('div', { class: 'spatial-expanded-list' }, rest.slice(0, limit).map(row)),
      ]);
      if (rest.length > limit) panel.append(button('显示更多', {
        class: 'spatial-project-more', 'data-spatial-project-more': active.project.key, 'data-focus-key': `spatial-project-more:${active.project.key}`,
      }, 'down'));
      grid.append(panel);
    }
  });
  return grid;
}

export function spatialProjectSection(cards: SpatialCard[], options: ProjectOptions): HTMLElement {
  const grid = spatialProjectGrid(cards, options);
  return el('section', { class: 'spatial-projects', 'aria-label': '项目' }, [
    el('div', { class: 'spatial-section-heading' }, [el('h2', {}, ['项目'])]),
    grid,
  ]);
}

export interface RecentOptions {
  view: SpatialView; row: Row; scope: string; focusedRecord?: string | null;
  label: (date: string) => string; periodLabel?: string; rangeLabel?: string;
  pinnedKeys: readonly string[] | ReadonlySet<string>; today: string; moreDatesOpen: boolean;
}
export function spatialRecentSection(groups: RecentDisplayGroup[], options: RecentOptions): HTMLElement {
  const { view, row } = options;
  const presentation = selectRecentPresentation(groups, options.pinnedKeys, options.today);
  const remainingGroups = [...presentation.remaining, ...(presentation.primary.length ? presentation.neutral : [])];
  const moreOpen = options.moreDatesOpen || !!options.focusedRecord && remainingGroups.some(group => group.records.some(record => record.key === options.focusedRecord));
  const renderBand = (group: RecentDisplayGroup, kind: 'pinned' | 'date' | 'undated'): HTMLElement => {
    const key = `recent:${options.scope}:${group.key}`;
    const focusIndex = options.focusedRecord ? group.records.findIndex(record => record.key === options.focusedRecord) : -1;
    if (focusIndex >= 0) {
      view.collapsedDates = view.collapsedDates.filter(item => item !== key);
      if (focusIndex >= (view.dateLimits[key] || SPATIAL_DATE_ROWS)) view.dateLimits[key] = SPATIAL_DATE_ROWS + Math.ceil((focusIndex + 1 - SPATIAL_DATE_ROWS) / SPATIAL_DATE_STEP) * SPATIAL_DATE_STEP;
    }
    const collapsed = view.collapsedDates.includes(key), limit = view.dateLimits[key] || SPATIAL_DATE_ROWS;
    const heading = kind === 'pinned' ? '置顶' : group.date ? options.label(group.date) : '本时间段';
    const id = `spatial-date-${encodeURIComponent(key)}`;
    const content = el('div', { class: 'spatial-date-content', id }, [el('div', { class: 'spatial-date-list' }, group.records.slice(0, limit).map(row))]);
    if (group.records.length > limit) content.append(button('显示更多', {
      class: 'spatial-date-more', 'data-spatial-date-more': key, 'data-focus-key': `spatial-date-more:${key}`,
    }, 'down'));
    content.hidden = collapsed;
    const band = el('article', { class: 'date-window spatial-date-band', 'data-recent-kind': kind, ...(group.date ? { 'data-date': group.date } : {}) }, [
      button('', { class: 'spatial-date-heading', 'data-spatial-date-toggle': key, 'data-focus-key': `spatial-date:${key}`, 'aria-expanded': String(!collapsed), 'aria-controls': id,
        'aria-label': `${collapsed ? '展开' : '收起'}${heading}的会话` }), content,
    ]);
    band.querySelector('button')!.append(icon('down'), el('span', {}, [el('strong', {}, [heading])]));
    return band;
  };
  const moreId = 'recent-more-dates';
  const remaining = el('div', { class: 'date-grid spatial-remaining-dates', id: moreId }, moreOpen ? remainingGroups.map(group => renderBand(group, group.date ? 'date' : 'undated')) : []);
  remaining.hidden = !moreOpen;
  const section = el('section', { class: 'date-section recent-section', 'aria-label': '最近' }, [
    el('div', { class: 'section-heading spatial-section-heading' }, [el('h2', {}, ['最近']),
      button('管理置顶', { id: 'recent-manage-pins', class: 'text-button', 'data-focus-key': 'recent-manage-pins' })]),
    el('div', { class: 'date-grid' }, presentation.primary.map(group => renderBand(group, group.kind === 'pinned' ? 'pinned' : 'date'))),
    remainingGroups.length ? remaining : null,
    !presentation.primary.length && presentation.neutral.length ? el('div', { class: 'date-grid spatial-neutral-dates' }, presentation.neutral.map(group => renderBand(group, 'undated'))) : null,
  ]);
  if (remainingGroups.length) section.append(button('', { id: 'recent-toggle-more', class: 'icon-button recent-toggle-more',
    'data-focus-key': 'recent-toggle-more', 'aria-expanded': String(moreOpen), 'aria-controls': moreId,
    'aria-label': moreOpen ? '收起更多日期' : '展开更多日期', title: moreOpen ? '收起更多日期' : '展开更多日期' }, 'down'));
  return section;
}
