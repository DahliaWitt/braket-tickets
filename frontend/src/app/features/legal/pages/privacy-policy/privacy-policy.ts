import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ContentLayoutComponent } from '@/layout/content-layout/content-layout.component';

@Component({
  selector: 'app-privacy-policy',
  imports: [ContentLayoutComponent],
  templateUrl: './privacy-policy.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyPolicyComponent {}
