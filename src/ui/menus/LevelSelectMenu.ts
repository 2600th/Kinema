import { LevelSaveStore, type LevelSaveMeta } from '@level/LevelSaveStore';

interface LevelSelectOptions {
  onSelectLevel: (key: string) => void;
  onPlayProcedural: () => void;
  onBack: () => void;
}

export class LevelSelectMenu {
  readonly id = 'levelSelect';
  readonly root: HTMLDivElement;

  private listContainer: HTMLDivElement;
  private options: LevelSelectOptions;

  constructor(options: LevelSelectOptions) {
    this.options = options;
    this.root = document.createElement('div');
    this.root.className = 'menu-screen';

    // Title
    const title = document.createElement('h1');
    title.className = 'menu-title';
    title.textContent = 'Level Select';
    this.root.appendChild(title);

    // Procedural Demo button (always first, primary style)
    const proceduralBtn = document.createElement('button');
    proceduralBtn.className = 'menu-button';
    proceduralBtn.textContent = 'Procedural Demo';
    proceduralBtn.addEventListener('click', () => this.options.onPlayProcedural());
    this.root.appendChild(proceduralBtn);

    // Scrollable level list
    this.listContainer = document.createElement('div');
    this.listContainer.className = 'menu-level-list';
    this.root.appendChild(this.listContainer);

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'menu-button';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => this.options.onBack());
    this.root.appendChild(backBtn);
  }

  show(): void {
    this.root.classList.add('active');
    this.refreshList();
  }

  hide(): void {
    this.root.classList.remove('active');
  }

  dispose(): void {
    this.root.remove();
  }

  private refreshList(): void {
    this.listContainer.innerHTML = '';
    const levels = LevelSaveStore.list();

    if (levels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'menu-level-empty';
      empty.textContent = 'No saved levels yet. Use the editor (F1) to create one.';
      this.listContainer.appendChild(empty);
      return;
    }

    for (const meta of levels) {
      this.listContainer.appendChild(this.createLevelCard(meta));
    }
  }

  private createLevelCard(meta: LevelSaveMeta): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'menu-level-card';

    // Info column
    const info = document.createElement('div');
    info.className = 'menu-level-info';

    const name = document.createElement('div');
    name.className = 'menu-level-name';
    name.textContent = meta.name;
    info.appendChild(name);

    const details = document.createElement('div');
    details.className = 'menu-level-details';
    const date = new Date(meta.modified).toLocaleDateString();
    details.textContent = `${meta.objectCount} objects \u00b7 ${date}`;
    info.appendChild(details);

    card.appendChild(info);

    // Actions column
    const actions = document.createElement('div');
    actions.className = 'menu-level-actions';

    const playBtn = document.createElement('button');
    playBtn.className = 'menu-button-small';
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', () => this.options.onSelectLevel(meta.key));
    actions.appendChild(playBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'menu-button-small menu-button-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      if (confirm(`Delete "${meta.name}"?`)) {
        LevelSaveStore.delete(meta.key);
        this.refreshList();
      }
    });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    return card;
  }
}
