import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {inject, Injectable} from '@angular/core';
import type {PublicCommunity} from '@shared/contracts/public-community';
import {environment} from '../../../environments/environment';
import {firstValueFrom} from 'rxjs';

const PUBLIC_COMMUNITIES_API_PATH = `${environment.convexSiteUrl}/api/communities`;

export type {PublicCommunity} from '@shared/contracts/public-community';

@Injectable({
  providedIn: 'root',
})
export class PublicCommunitiesService {
  private readonly http = inject(HttpClient);

  listDirectory(): Promise<PublicCommunity[]> {
    return firstValueFrom(
      this.http.get<PublicCommunity[]>(PUBLIC_COMMUNITIES_API_PATH),
    );
  }

  async getBySlug(slug: string): Promise<PublicCommunity | null> {
    try {
      return await firstValueFrom(
        this.http.get<PublicCommunity>(
          `${PUBLIC_COMMUNITIES_API_PATH}/${encodeURIComponent(slug)}`,
        ),
      );
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        return null;
      }
      throw error;
    }
  }
}
