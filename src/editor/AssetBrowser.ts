type AssetType = 'primitive' | 'glb' | 'sprite';

export interface AssetEntry {
  type: AssetType;
  name: string;
  url?: string;
  primitive?: string;
}

export class AssetBrowser {
  private entries: AssetEntry[] = [];

  constructor(private container: HTMLElement, private onSelect: (asset: AssetEntry) => void) {
    this.buildEntries();
    this.render();
  }

  dispose(): void {
    this.container.innerHTML = '';
  }

  private buildEntries(): void {
    const primitiveNames = ['cube', 'sphere', 'cylinder', 'capsule', 'plane'];
    primitiveNames.forEach((name) => {
      this.entries.push({ type: 'primitive', name, primitive: name });
    });

    const modelImports = import.meta.glob('../assets/models/*.glb', { eager: true, import: 'default' }) as Record<
      string,
      string
    >;
    for (const [path, url] of Object.entries(modelImports)) {
      const name = path.split('/').pop()?.replace('.glb', '') ?? 'model';
      this.entries.push({ type: 'glb', name, url });
    }

    const spriteImports = import.meta.glob('../assets/sprites/*.png', { eager: true, import: 'default' }) as Record<
      string,
      string
    >;
    for (const [path, url] of Object.entries(spriteImports)) {
      const name = path.split('/').pop()?.replace('.png', '') ?? 'sprite';
      this.entries.push({ type: 'sprite', name, url });
    }
  }

  private render(): void {
    this.container.innerHTML = '';
    const title = document.createElement('div');
    title.textContent = 'Assets';
    title.style.marginBottom = '8px';
    this.container.appendChild(title);

    for (const entry of this.entries) {
      const item = document.createElement('button');
      item.textContent = entry.name;
      item.style.cssText = `
        width: 100%;
        margin-bottom: 6px;
        padding: 6px 8px;
        border: none;
        border-radius: 6px;
        background: rgba(79, 195, 247, 0.2);
        color: #e0e0e0;
        cursor: pointer;
      `;
      item.addEventListener('click', () => this.onSelect(entry));
      this.container.appendChild(item);
    }
  }
}
