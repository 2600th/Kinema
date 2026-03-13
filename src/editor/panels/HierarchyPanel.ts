import { EditorPanel } from './EditorPanel';
import type { EditorObject } from '../EditorObject';

export interface HierarchyCallbacks {
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onReparent: (childId: string, newParentId: string | null) => void;
  onGroup: (ids: string[]) => void;
  onUngroup: (groupId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Internal tree node — built from the flat EditorObject list        */
/* ------------------------------------------------------------------ */
interface TreeNode {
  obj: EditorObject;
  children: TreeNode[];
  depth: number;
}

/* ------------------------------------------------------------------ */
/*  SVG icon paths (16x16 viewBox)                                    */
/* ------------------------------------------------------------------ */
const ICON_EYE_OPEN =
  'M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5ZM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z';
const ICON_EYE_CLOSED =
  'M2.5 2.5l11 11M6.7 6.7A2.5 2.5 0 0 0 9.3 9.3M1 8s2.5-5 7-5c1.2 0 2.3.4 3.2.9M15 8s-2.5 5-7 5c-1.2 0-2.3-.4-3.2-.9';
const ICON_LOCK =
  'M4 7V5a4 4 0 1 1 8 0v2M3 7h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z';
const ICON_UNLOCK =
  'M11 5V4a4 4 0 0 0-7.5-1.5M3 7h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z';
const ICON_TOGGLE =
  'M4 6l4 4 4-4'; // chevron right (rotated 90deg when expanded)

/* ------------------------------------------------------------------ */
/*  HierarchyPanel                                                    */
/* ------------------------------------------------------------------ */
export class HierarchyPanel extends EditorPanel {
  private objects: EditorObject[] = [];
  private selectionId: string | null = null;
  private expandedIds = new Set<string>();
  private filterText = '';

  /* DOM refs */
  private headerBadge!: HTMLSpanElement;
  private searchInput!: HTMLInputElement;
  private treeContainer!: HTMLDivElement;
  private contextMenu!: HTMLDivElement;

  /* Drag state */
  private draggedId: string | null = null;

  /* Search debounce */
  private searchTimeout: ReturnType<typeof setTimeout> | undefined;

  /* Bound handlers (for cleanup) */
  private readonly handleDocClick: (e: MouseEvent) => void;
  private readonly handleDocKeydown: (e: KeyboardEvent) => void;

  constructor(private callbacks: HierarchyCallbacks) {
    super('hierarchy', 'Scene');

    this.handleDocClick = (e: MouseEvent) => {
      if (!this.contextMenu.contains(e.target as Node)) {
        this.hideContextMenu();
      }
    };
    this.handleDocKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.hideContextMenu();
    };
  }

  /* --- public API ------------------------------------------------- */

  setObjects(objects: EditorObject[]): void {
    this.objects = objects;
    this.renderTree();
  }

  setSelection(id: string | null): void {
    this.selectionId = id;
    this.renderTree();
  }

  /* --- lifecycle --------------------------------------------------- */

  build(): void {
    const el = this.container;
    el.className = 'ke-panel ke-panel-hierarchy ke-hidden';
    Object.assign(el.style, {
      position: 'fixed',
      top: '60px',
      left: '12px',
      width: '240px',
      maxHeight: 'calc(100vh - 80px)',
      zIndex: '10000',
      overflowY: 'auto',
    });

    /* -- Header -- */
    const header = document.createElement('div');
    header.className = 'ke-panel-header';

    const titleWrap = document.createElement('div');
    titleWrap.style.display = 'flex';
    titleWrap.style.alignItems = 'center';
    titleWrap.style.gap = '8px';

    const titleLabel = document.createElement('span');
    titleLabel.textContent = 'Scene';
    titleWrap.appendChild(titleLabel);

    this.headerBadge = document.createElement('span');
    Object.assign(this.headerBadge.style, {
      fontSize: 'var(--ke-font-size-sm)',
      color: 'var(--ke-text-dim)',
      background: 'var(--ke-input-bg)',
      padding: '1px 6px',
      borderRadius: 'var(--ke-radius-pill)',
    });
    this.headerBadge.textContent = '0';
    titleWrap.appendChild(this.headerBadge);
    header.appendChild(titleWrap);

    /* Collapse toggle in header */
    const collapseBtn = document.createElement('span');
    collapseBtn.textContent = '\u2015'; // horizontal bar
    collapseBtn.style.cursor = 'pointer';
    collapseBtn.style.opacity = '0.5';
    collapseBtn.addEventListener('click', () => this.toggleCollapse());
    header.appendChild(collapseBtn);

    el.appendChild(header);

    /* -- Body wrapper -- */
    const body = document.createElement('div');
    body.className = 'ke-panel-body';

    /* Search input */
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.className = 'ke-input';
    this.searchInput.placeholder = 'Filter...';
    this.searchInput.style.marginBottom = '4px';
    this.searchInput.addEventListener('input', () => {
      this.filterText = this.searchInput.value;
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => this.renderTree(), 150);
    });
    body.appendChild(this.searchInput);

    /* Tree container */
    this.treeContainer = document.createElement('div');
    this.treeContainer.className = 'ke-hierarchy';
    body.appendChild(this.treeContainer);

    el.appendChild(body);

    /* -- Context menu (hidden) -- */
    this.contextMenu = document.createElement('div');
    this.contextMenu.className = 'ke-context-menu ke-hidden';
    document.body.appendChild(this.contextMenu);

    /* Global listeners for context menu dismiss */
    document.addEventListener('click', this.handleDocClick);
    document.addEventListener('keydown', this.handleDocKeydown);

    /* Drop on the panel empty area → reparent to root */
    this.treeContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    this.treeContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      if (this.draggedId) {
        this.callbacks.onReparent(this.draggedId, null);
        this.draggedId = null;
      }
    });
  }

  update(): void {
    // state-driven — no per-frame work
  }

  override dispose(): void {
    document.removeEventListener('click', this.handleDocClick);
    document.removeEventListener('keydown', this.handleDocKeydown);
    this.contextMenu.remove();
    super.dispose();
  }

  /* --- tree building ---------------------------------------------- */

  private buildTree(): TreeNode[] {
    const map = new Map<string, EditorObject>();
    for (const obj of this.objects) map.set(obj.id, obj);

    const roots: TreeNode[] = [];
    const nodeMap = new Map<string, TreeNode>();

    // Create nodes
    for (const obj of this.objects) {
      nodeMap.set(obj.id, { obj, children: [], depth: 0 });
    }

    // Link children
    for (const obj of this.objects) {
      const node = nodeMap.get(obj.id)!;
      const pid = obj.parentId;
      if (pid && nodeMap.has(pid)) {
        nodeMap.get(pid)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // Assign depths
    const assignDepth = (nodes: TreeNode[], d: number): void => {
      for (const n of nodes) {
        n.depth = d;
        assignDepth(n.children, d + 1);
      }
    };
    assignDepth(roots, 0);

    return roots;
  }

  /* --- filtering -------------------------------------------------- */

  /**
   * Returns a set of object ids that match the filter or are ancestors of
   * matching objects (so the tree structure is preserved).
   */
  private computeVisibleIds(roots: TreeNode[]): Set<string> | null {
    const term = this.filterText.toLowerCase().trim();
    if (!term) return null; // show everything

    const visible = new Set<string>();

    const walk = (node: TreeNode): boolean => {
      const selfMatch = node.obj.name.toLowerCase().includes(term);
      let childMatch = false;
      for (const child of node.children) {
        if (walk(child)) childMatch = true;
      }
      if (selfMatch || childMatch) {
        visible.add(node.obj.id);
        return true;
      }
      return false;
    };
    for (const root of roots) walk(root);
    return visible;
  }

  /* --- render ----------------------------------------------------- */

  private renderTree(): void {
    if (!this.treeContainer) return;
    this.treeContainer.innerHTML = '';

    this.headerBadge.textContent = String(this.objects.length);

    const roots = this.buildTree();
    const visibleIds = this.computeVisibleIds(roots);

    const renderNodes = (nodes: TreeNode[]): void => {
      for (const node of nodes) {
        if (visibleIds && !visibleIds.has(node.obj.id)) continue;
        this.treeContainer.appendChild(this.createRow(node));
        if (node.children.length > 0 && this.expandedIds.has(node.obj.id)) {
          renderNodes(node.children);
        }
      }
    };
    renderNodes(roots);
  }

  /* --- row creation ----------------------------------------------- */

  private createRow(node: TreeNode): HTMLDivElement {
    const { obj, depth } = node;
    const isSelected = obj.id === this.selectionId;
    const hasChildren = node.children.length > 0;
    const isExpanded = this.expandedIds.has(obj.id);
    const isVisible = obj.visible !== false;
    const isLocked = obj.locked === true;

    const row = document.createElement('div');
    row.className = 'ke-tree-row' + (isSelected ? ' ke-tree-row-selected' : '');
    row.draggable = true;

    /* indent */
    const indent = document.createElement('span');
    indent.className = 'ke-tree-row-indent';
    indent.style.width = `${depth * 16}px`;
    row.appendChild(indent);

    /* expand / collapse toggle */
    const toggle = document.createElement('span');
    toggle.className = 'ke-tree-row-toggle' + (isExpanded ? ' expanded' : '');
    if (hasChildren) {
      toggle.appendChild(this.svgIcon(ICON_TOGGLE, 14));
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.expandedIds.has(obj.id)) {
          this.expandedIds.delete(obj.id);
        } else {
          this.expandedIds.add(obj.id);
        }
        this.renderTree();
      });
    } else {
      // empty spacer so alignment stays consistent
      toggle.style.visibility = 'hidden';
      toggle.appendChild(this.svgIcon(ICON_TOGGLE, 14));
    }
    row.appendChild(toggle);

    /* label */
    const label = document.createElement('span');
    label.className = 'ke-tree-row-label';
    label.textContent = obj.name;
    row.appendChild(label);

    /* hover actions */
    const actions = document.createElement('span');
    actions.className = 'ke-tree-row-actions';
    Object.assign(actions.style, {
      display: 'flex',
      gap: '2px',
      marginLeft: 'auto',
      opacity: '0',
      transition: 'opacity var(--ke-transition)',
    });

    /* eye icon */
    const eyeBtn = this.createActionBtn(
      isVisible ? ICON_EYE_OPEN : ICON_EYE_CLOSED,
      'Toggle visibility',
      (e) => {
        e.stopPropagation();
        this.callbacks.onToggleVisible(obj.id);
      },
    );
    if (!isVisible) eyeBtn.style.opacity = '0.35';
    actions.appendChild(eyeBtn);

    /* lock icon */
    const lockBtn = this.createActionBtn(
      isLocked ? ICON_LOCK : ICON_UNLOCK,
      'Toggle lock',
      (e) => {
        e.stopPropagation();
        this.callbacks.onToggleLock(obj.id);
      },
    );
    if (isLocked) lockBtn.style.color = 'var(--ke-warning)';
    actions.appendChild(lockBtn);

    row.appendChild(actions);

    /* Show actions on hover */
    row.addEventListener('mouseenter', () => {
      actions.style.opacity = '1';
    });
    row.addEventListener('mouseleave', () => {
      actions.style.opacity = '0';
    });

    /* Click → select */
    row.addEventListener('click', () => {
      this.callbacks.onSelect(isSelected ? null : obj.id);
    });

    /* Right-click → context menu */
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Ensure selected first
      if (!isSelected) this.callbacks.onSelect(obj.id);
      this.showContextMenu(e.clientX, e.clientY, obj);
    });

    /* Drag start */
    row.addEventListener('dragstart', (e) => {
      this.draggedId = obj.id;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', obj.id);
      }
    });

    /* Drag over */
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.draggedId && this.draggedId !== obj.id) {
        row.style.borderBottom = '2px solid var(--ke-accent)';
      }
    });

    row.addEventListener('dragleave', () => {
      row.style.borderBottom = '';
    });

    /* Drop */
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.style.borderBottom = '';
      if (this.draggedId && this.draggedId !== obj.id) {
        this.callbacks.onReparent(this.draggedId, obj.id);
        this.draggedId = null;
      }
    });

    return row;
  }

  /* --- context menu ----------------------------------------------- */

  private showContextMenu(x: number, y: number, obj: EditorObject): void {
    const menu = this.contextMenu;
    menu.innerHTML = '';
    menu.classList.remove('ke-hidden');
    Object.assign(menu.style, { left: `${x}px`, top: `${y}px` });

    const items: { label: string; action: () => void; disabled?: boolean }[] = [
      {
        label: 'Rename',
        action: () => this.startInlineRename(obj),
      },
      {
        label: 'Duplicate',
        action: () => this.callbacks.onDuplicate(obj.id),
      },
      {
        label: 'Delete',
        action: () => this.callbacks.onDelete(obj.id),
      },
      {
        label: 'Group Selected',
        action: () => this.callbacks.onGroup(this.selectionId ? [this.selectionId] : []),
        disabled: !this.selectionId,
      },
      {
        label: 'Ungroup',
        action: () => this.callbacks.onUngroup(obj.id),
        disabled: !obj.children || obj.children.length === 0,
      },
    ];

    for (const item of items) {
      const row = document.createElement('div');
      row.className =
        'ke-context-menu-item' + (item.disabled ? ' ke-context-menu-item-disabled' : '');
      row.textContent = item.label;
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideContextMenu();
        if (!item.disabled) item.action();
      });
      menu.appendChild(row);
    }

    // Clamp within viewport
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = `${window.innerWidth - rect.width - 4}px`;
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = `${window.innerHeight - rect.height - 4}px`;
      }
    });
  }

  private hideContextMenu(): void {
    this.contextMenu.classList.add('ke-hidden');
  }

  /* --- inline rename ---------------------------------------------- */

  private startInlineRename(obj: EditorObject): void {
    // Find the label span for this object in the tree container
    const rows = this.treeContainer.querySelectorAll<HTMLDivElement>('.ke-tree-row');
    for (const row of rows) {
      const label = row.querySelector<HTMLSpanElement>('.ke-tree-row-label');
      if (label && label.textContent === obj.name) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ke-input';
        input.value = obj.name;
        Object.assign(input.style, {
          flex: '1',
          padding: '1px 4px',
          fontSize: 'var(--ke-font-size)',
          minWidth: '0',
        });

        const commit = (): void => {
          const newName = input.value.trim();
          if (newName && newName !== obj.name) {
            this.callbacks.onRename(obj.id, newName);
          } else {
            // Revert — just re-render
            this.renderTree();
          }
        };

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            this.renderTree();
          }
        });

        input.addEventListener('blur', commit);

        label.replaceWith(input);
        input.focus();
        input.select();
        break;
      }
    }
  }

  /* --- helpers ----------------------------------------------------- */

  private svgIcon(pathD: string, size: number): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    svg.appendChild(path);
    return svg;
  }

  private createActionBtn(
    iconPath: string,
    title: string,
    onClick: (e: MouseEvent) => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'ke-btn ke-btn-icon';
    btn.title = title;
    Object.assign(btn.style, {
      width: '20px',
      height: '20px',
      padding: '2px',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--ke-text-dim)',
    });
    btn.appendChild(this.svgIcon(iconPath, 14));
    btn.addEventListener('click', onClick);
    return btn;
  }
}
