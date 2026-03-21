export abstract class EditorPanel {
  protected container: HTMLDivElement;
  protected collapsed = false;
  protected visible = false;

  /* ---- Drag state ---- */
  private dragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private readonly onDragMove: (e: MouseEvent) => void;
  private readonly onDragEnd: () => void;
  private readonly onResize: () => void;
  private readonly onDragStart: (e: MouseEvent) => void;
  private dragHandle: HTMLElement | null = null;
  private hasDragged = false;

  constructor(protected id: string, protected title: string) {
    this.container = document.createElement('div');
    this.container.className = `ke-panel ke-panel-${id} ke-hidden`;

    this.onDragMove = (e: MouseEvent) => {
      if (!this.dragging) return;
      const x = e.clientX - this.dragOffsetX;
      const y = e.clientY - this.dragOffsetY;
      // Clamp within viewport
      const rect = this.container.getBoundingClientRect();
      const clampedX = Math.max(0, Math.min(x, window.innerWidth - rect.width));
      const clampedY = Math.max(0, Math.min(y, window.innerHeight - 40));
      this.container.style.left = `${clampedX}px`;
      this.container.style.top = `${clampedY}px`;
      // Clear right/transform so left/top take full control
      this.container.style.right = 'auto';
      this.container.style.transform = 'none';
    };

    this.onDragEnd = () => {
      this.dragging = false;
      document.body.style.cursor = '';
      this.container.style.transition = '';
    };

    this.onResize = () => {
      if (!this.hasDragged) return;
      const rect = this.container.getBoundingClientRect();
      const clampedX = Math.max(0, Math.min(rect.left, window.innerWidth - rect.width));
      const clampedY = Math.max(0, Math.min(rect.top, window.innerHeight - 40));
      this.container.style.left = `${clampedX}px`;
      this.container.style.top = `${clampedY}px`;
    };

    this.onDragStart = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, [role="button"]')) return;

      e.preventDefault();
      this.dragging = true;
      this.hasDragged = true;
      this.container.style.transition = 'none';
      document.body.style.cursor = 'grabbing';

      const rect = this.container.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;

      if (this.container.style.right && this.container.style.right !== 'auto') {
        this.container.style.left = `${rect.left}px`;
        this.container.style.right = 'auto';
        this.container.style.transform = 'none';
      }
      if (this.container.style.transform && this.container.style.transform.includes('translate')) {
        this.container.style.left = `${rect.left}px`;
        this.container.style.transform = 'none';
      }
    };
  }

  show(): void {
    this.container.classList.remove('ke-hidden');
    this.visible = true;
  }

  hide(): void {
    this.container.classList.add('ke-hidden');
    this.visible = false;
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    this.container.classList.toggle('ke-panel-collapsed', this.collapsed);
    this.onCollapse(this.collapsed);
  }

  getElement(): HTMLDivElement {
    return this.container;
  }

  abstract build(): void;
  abstract update(): void;

  protected onCollapse(_collapsed: boolean): void {}

  /**
   * Enables drag-to-move on a header element.
   * Call this in build() after creating the panel header.
   */
  protected enableDrag(handle: HTMLElement): void {
    handle.style.cursor = 'grab';
    this.dragHandle = handle;
    handle.addEventListener('mousedown', this.onDragStart);

    window.addEventListener('mousemove', this.onDragMove);
    window.addEventListener('mouseup', this.onDragEnd);
    window.addEventListener('resize', this.onResize);
  }

  dispose(): void {
    if (this.dragHandle) {
      this.dragHandle.removeEventListener('mousedown', this.onDragStart);
    }
    window.removeEventListener('mousemove', this.onDragMove);
    window.removeEventListener('mouseup', this.onDragEnd);
    window.removeEventListener('resize', this.onResize);
    this.container.remove();
  }
}
