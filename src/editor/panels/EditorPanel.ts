export abstract class EditorPanel {
  protected container: HTMLDivElement;
  protected collapsed = false;
  protected visible = false;

  constructor(protected id: string, protected title: string) {
    this.container = document.createElement('div');
    this.container.className = `ke-panel ke-panel-${id} ke-hidden`;
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

  dispose(): void {
    this.container.remove();
  }
}
