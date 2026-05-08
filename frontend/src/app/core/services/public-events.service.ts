import {HttpClient} from '@angular/common/http';
import {inject, Injectable} from '@angular/core';
import type {PublicEventCard} from '@shared/contracts/public-event';
import {firstValueFrom} from 'rxjs';
import {environment} from '../../../environments/environment';

export type {PublicEventCard} from '@shared/contracts/public-event';

@Injectable({
  providedIn: 'root',
})
export class PublicEventsService {
  private readonly http = inject(HttpClient);

  listUpcoming(): Promise<PublicEventCard[]> {
    return firstValueFrom(
      this.http.get<PublicEventCard[]>(
        `${environment.convexSiteUrl}/api/events/upcoming`,
      ),
    );
  }
}
