import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { BraDarkMode, EDarkModes, type DarkModeOptions } from '@ui/services/dark-mode';
import { ZardIconComponent } from '@ui/components/primitives/icon/icon.component';
import { ZardButtonComponent } from '@ui/components/primitives/button/button.component';
import { BraDropdownMenuContentComponent } from '@ui/components/composites/dropdown/dropdown-menu-content.component';
import { BraDropdownMenuItemComponent } from '@ui/components/composites/dropdown/dropdown-item.component';
import { BraDropdownDirective } from '@ui/components/composites/dropdown/dropdown-trigger.directive';

@Component({
  selector: 'app-theme-toggle',
  imports: [
    ZardIconComponent,
    ZardButtonComponent,
    BraDropdownMenuContentComponent,
    BraDropdownMenuItemComponent,
    BraDropdownDirective,
  ],
  template: `
    <div class="border border-border rounded-md flex" data-testid="theme-toggle-root">
      <!-- Primary: one-click toggle -->
      <button
        type="button"
        z-button
        zType="ghost"
        [attr.aria-label]="primaryAriaLabel()"
        data-testid="theme-primary-btn"
        class="w-9 px-0 border-0 rounded-none rounded-l-md group"
        (click)="toggleQuick()"
      >
        <z-icon
          [zType]="currentIcon()"
          class="h-[1.2rem] w-[1.2rem] text-muted-foreground group-hover:text-foreground transition-colors"
        />
      </button>

      <!-- Internal divider -->
      <div class="w-px bg-border self-stretch" aria-hidden="true"></div>

      <!-- Trailing: chevron opens dropdown -->
      <button
        type="button"
        z-button
        bra-dropdown
        [braDropdownMenu]="menu"
        zType="ghost"
        aria-label="Theme options"
        data-testid="theme-chevron-btn"
        class="w-7 px-0 border-0 rounded-none rounded-r-md group"
      >
        <z-icon
          zType="chevron-down"
          class="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors"
        />
      </button>
    </div>

    <bra-dropdown-menu-content
      #menu="braDropdownMenuContent"
      class="w-40 bg-popover border border-border rounded-md p-1 shadow-lg"
    >
      <div role="group" aria-label="Theme">
        <button
          type="button"
          bra-dropdown-menu-item
          [role]="'menuitemradio'"
          [attr.data-active]="darkMode.theme() === theme.LIGHT"
          [attr.aria-checked]="darkMode.theme() === theme.LIGHT"
          class="flex w-full items-center gap-2 px-2 py-1.5 text-xs font-mono uppercase tracking-widest hover:bg-primary/10 hover:text-foreground"
          (click)="setTheme(theme.LIGHT)"
        >
          <z-icon zType="sun" class="h-4 w-4" />
          <span class="grow text-left">Light</span>
          @if (darkMode.theme() === theme.LIGHT) {
            <z-icon zType="check" class="h-4 w-4 text-primary" />
          }
        </button>

        <button
          type="button"
          bra-dropdown-menu-item
          [role]="'menuitemradio'"
          [attr.data-active]="darkMode.theme() === theme.DARK"
          [attr.aria-checked]="darkMode.theme() === theme.DARK"
          class="flex w-full items-center gap-2 px-2 py-1.5 text-xs font-mono uppercase tracking-widest hover:bg-primary/10 hover:text-foreground"
          (click)="setTheme(theme.DARK)"
        >
          <z-icon zType="moon" class="h-4 w-4" />
          <span class="grow text-left">Dark</span>
          @if (darkMode.theme() === theme.DARK) {
            <z-icon zType="check" class="h-4 w-4 text-primary" />
          }
        </button>

        <button
          type="button"
          bra-dropdown-menu-item
          [role]="'menuitemradio'"
          [attr.data-active]="darkMode.theme() === theme.SYSTEM"
          [attr.aria-checked]="darkMode.theme() === theme.SYSTEM"
          class="flex w-full items-center gap-2 px-2 py-1.5 text-xs font-mono uppercase tracking-widest hover:bg-primary/10 hover:text-foreground"
          (click)="setTheme(theme.SYSTEM)"
        >
          <z-icon zType="sun-moon" class="h-4 w-4" />
          <span class="grow text-left">System</span>
          @if (darkMode.theme() === theme.SYSTEM) {
            <z-icon zType="check" class="h-4 w-4 text-primary" />
          }
        </button>
      </div>
    </bra-dropdown-menu-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeToggleComponent {
  protected readonly darkMode = inject(BraDarkMode);
  protected readonly theme = EDarkModes;

  protected readonly currentIcon = computed(() => {
    const theme = this.darkMode.theme();
    if (theme === EDarkModes.LIGHT) return 'sun';
    if (theme === EDarkModes.DARK) return 'moon';
    return 'sun-moon';
  });

  readonly primaryAriaLabel = computed(() => {
    const mode = this.darkMode.themeMode();
    return mode === EDarkModes.DARK ? 'Switch to light theme' : 'Switch to dark theme';
  });

  toggleQuick(): void {
    this.darkMode.toggleTheme();
  }

  setTheme(mode: DarkModeOptions) {
    this.darkMode.toggleTheme(mode);
  }
}
