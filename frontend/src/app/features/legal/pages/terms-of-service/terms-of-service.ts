import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ContentLayoutComponent } from '@/layout/content-layout/content-layout.component';

@Component({
  selector: 'app-terms-of-service',
  imports: [ContentLayoutComponent],
  templateUrl: './terms-of-service.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsOfServiceComponent {}
