import {describe, it, expect, beforeEach, vi} from 'vitest';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {MainLayoutComponent} from './main-layout.component';
import {AuthService} from '@/core/services/auth.service';
import {signal, type WritableSignal} from '@angular/core';
import type {Id} from '@convex/_generated/dataModel';
import {CommunityAdminDefaultService} from '@/features/admin/services/community-admin-default.service';

describe('MainLayoutComponent', () => {
  let fixture: ComponentFixture<MainLayoutComponent>;
  let component: MainLayoutComponent;
  let defaultCommunityId: WritableSignal<Id<'organizers'> | null>;
  let mockAuth: {
    isAuthenticated: ReturnType<typeof signal>;
    user: ReturnType<typeof signal>;
    userRole: ReturnType<typeof signal>;
    isScannerStaff: ReturnType<typeof signal>;
    isCommunityAdmin: ReturnType<typeof signal>;
    logout: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockAuth = {
      isAuthenticated: signal(false),
      user: signal(null),
      userRole: signal('user'),
      isScannerStaff: signal(false),
      isCommunityAdmin: signal(false),
      logout: vi.fn(),
    };
    defaultCommunityId = signal<Id<'organizers'> | null>(null);

    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent],
      providers: [
        provideRouter([]),
        {provide: AuthService, useValue: mockAuth},
        {
          provide: CommunityAdminDefaultService,
          useValue: {
            defaultCommunityId,
            isDefaultCommunity: vi.fn(),
            setDefaultCommunity: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MainLayoutComponent);
    component = fixture.componentInstance;
  });

  it('should return empty navItems when not authenticated', () => {
    expect(component.navItems()).toEqual([]);
  });

  it('should return base nav items for authenticated user', () => {
    mockAuth.isAuthenticated.set(true);
    mockAuth.user.set({name: 'Test', email: 'test@test.com'});

    const items = component.navItems();
    expect(items.length).toBe(4);
    expect(items.map((i) => i.label)).toEqual([
      'HOME',
      'MY TICKETS',
      'ACCOUNT',
      'LOGOUT',
    ]);
  });

  it('should include admin nav items for admin users', () => {
    mockAuth.isAuthenticated.set(true);
    mockAuth.user.set({name: 'Admin', email: 'admin@test.com'});
    mockAuth.userRole.set('root_admin');

    const items = component.navItems();
    const labels = items.map((i) => i.label);
    expect(labels).toContain('ADMIN PORTAL ACCESS');
    expect(labels).toContain('TICKET SCANNER');
    expect(labels).toContain('COMMUNITY ADMIN');
  });

  it('should include scanner nav for scanner staff', () => {
    mockAuth.isAuthenticated.set(true);
    mockAuth.user.set({name: 'Staff', email: 'staff@test.com'});
    mockAuth.isScannerStaff.set(true);

    const items = component.navItems();
    const labels = items.map((i) => i.label);
    expect(labels).toContain('TICKET SCANNER');
    expect(labels).not.toContain('ADMIN PORTAL ACCESS');
  });

  it('should include community admin nav for community admins', () => {
    mockAuth.isAuthenticated.set(true);
    mockAuth.user.set({name: 'CA', email: 'ca@test.com'});
    mockAuth.isCommunityAdmin.set(true);

    const items = component.navItems();
    const labels = items.map((i) => i.label);
    expect(labels).toContain('COMMUNITY ADMIN');
    expect(labels).not.toContain('ADMIN PORTAL ACCESS');
  });

  it('should link community admin nav to the saved default community', () => {
    mockAuth.isAuthenticated.set(true);
    mockAuth.user.set({
      _id: 'user-1',
      name: 'CA',
      email: 'ca@test.com',
      communityAdminOrganizerIds: ['org-a', 'org-b'],
    });
    mockAuth.isCommunityAdmin.set(true);

    defaultCommunityId.set('org-a' as Id<'organizers'>);

    const communityAdminItem = component
      .navItems()
      .find((item) => item.label === 'COMMUNITY ADMIN');

    expect(communityAdminItem?.routerLink).toBe('/community-admin');
    expect(communityAdminItem?.queryParams).toEqual({community: 'org-a'});
  });

  it('should ignore saved default community for single-community admins', () => {
    mockAuth.isAuthenticated.set(true);
    mockAuth.user.set({
      _id: 'user-1',
      name: 'CA',
      email: 'ca@test.com',
      communityAdminOrganizerIds: ['org-a'],
    });
    mockAuth.isCommunityAdmin.set(true);

    defaultCommunityId.set('org-a' as Id<'organizers'>);

    const communityAdminItem = component
      .navItems()
      .find((item) => item.label === 'COMMUNITY ADMIN');

    expect(communityAdminItem?.routerLink).toBe('/community-admin');
    expect(communityAdminItem?.queryParams).toBeUndefined();
  });

  it('should use saved default community for root admins', () => {
    mockAuth.isAuthenticated.set(true);
    mockAuth.user.set({
      _id: 'root-1',
      name: 'Root',
      email: 'root@test.com',
      communityAdminOrganizerIds: [],
    });
    mockAuth.userRole.set('root_admin');

    defaultCommunityId.set('org-b' as Id<'organizers'>);

    const communityAdminItem = component
      .navItems()
      .find((item) => item.label === 'COMMUNITY ADMIN');

    expect(communityAdminItem?.queryParams).toEqual({community: 'org-b'});
  });
});
