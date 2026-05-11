import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  type Params,
  type Routes,
} from '@angular/router';
import type {Meta, StoryObj} from '@storybook/angular';
import {applicationConfig} from '@storybook/angular';
import {CONVEX} from 'convex-angular';
import {of} from 'rxjs';

import {AuthService} from '@/core/services/auth.service';
import {
  createStoryConvexClient,
  skipStoryConvexQueryUpdate,
} from '../../../../../storybook/mocks/convex';

import {InviteComponent} from './invite.component';

type InviteValidationError =
  | 'invalid'
  | 'paused'
  | 'disabled'
  | 'expired'
  | 'maxed';

interface InviteValidationResult {
  valid: boolean;
  error?: InviteValidationError;
  communityName?: string;
}

interface InviteStoryConfig {
  token: string;
  validationState: 'loading' | 'resolved';
  validationResult: InviteValidationResult;
  authenticated: boolean;
  redeemBehavior: 'pending' | 'unused';
}

const inviteStoryState: {
  token: string;
  validationState: InviteStoryConfig['validationState'];
  validationResult: InviteValidationResult;
  authenticated: boolean;
  userId: string;
  redeemBehavior: InviteStoryConfig['redeemBehavior'];
} = {
  token: 'invite-story-token',
  validationState: 'resolved',
  validationResult: {
    valid: true,
    communityName: 'Signal House',
  },
  authenticated: false,
  userId: 'user_story_invite',
  redeemBehavior: 'unused',
};

@Component({
  selector: 'bt-story-invite-route-stub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class InviteStoryRouteStubComponent {}

const STORY_ROUTES: Routes = [
  {path: '', component: InviteStoryRouteStubComponent},
  {path: 'login', component: InviteStoryRouteStubComponent},
  {path: 'invite/:token', component: InviteStoryRouteStubComponent},
  {path: '**', component: InviteStoryRouteStubComponent},
];

class StoryAuthService {
  private readonly session = signal<{_id: string} | undefined>(undefined);

  readonly isAuthenticated = computed(() => this.session() !== undefined);
  readonly user = computed(() => this.session());

  constructor() {
    this.session.set(
      inviteStoryState.authenticated
        ? {_id: inviteStoryState.userId}
        : undefined,
    );
  }

  handleOAuthCallback(_ott: string): Promise<void> {
    return Promise.resolve();
  }
}

const storyConvexClient = createStoryConvexClient({
  onUpdate: () => {
    if (inviteStoryState.validationState === 'resolved') {
      return inviteStoryState.validationResult;
    }

    return skipStoryConvexQueryUpdate();
  },
  mutation: async () => {
    if (inviteStoryState.redeemBehavior === 'pending') {
      return await new Promise(() => undefined);
    }

    return {
      success: true,
      alreadyRedeemed: false,
      alreadyMember: false,
      message: 'unused',
    };
  },
  hasAuth: () => inviteStoryState.authenticated,
});

function createActivatedRoute(): Pick<ActivatedRoute, 'paramMap' | 'snapshot'> {
  const params: Params = {token: inviteStoryState.token};

  return {
    paramMap: of(convertToParamMap(params)),
    snapshot: {
      paramMap: convertToParamMap(params),
    },
  } as Pick<ActivatedRoute, 'paramMap' | 'snapshot'>;
}

function setInviteStoryData(config: InviteStoryConfig): void {
  inviteStoryState.token = config.token;
  inviteStoryState.validationState = config.validationState;
  inviteStoryState.validationResult = config.validationResult;
  inviteStoryState.authenticated = config.authenticated;
  inviteStoryState.redeemBehavior = config.redeemBehavior;
}

const meta: Meta<InviteComponent> = {
  title: 'Braket/Archetypes/Invite',
  component: InviteComponent,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [
        provideRouter(STORY_ROUTES),
        {provide: CONVEX, useValue: storyConvexClient},
        {provide: AuthService, useClass: StoryAuthService},
        {provide: ActivatedRoute, useFactory: createActivatedRoute},
      ],
    }),
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Real invite page imported into Storybook. Stories document the actual route-driven access flow using mocked validation and auth states instead of a recreated page shell.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<InviteComponent>;

function renderInvite(config: InviteStoryConfig) {
  setInviteStoryData(config);
  return {};
}

export const LoadingValidation: Story = {
  render: () =>
    renderInvite({
      token: 'loading-token',
      validationState: 'loading',
      validationResult: {valid: true, communityName: 'Signal House'},
      authenticated: false,
      redeemBehavior: 'unused',
    }),
};

export const InviteOptions: Story = {
  render: () =>
    renderInvite({
      token: 'signal-house-token',
      validationState: 'resolved',
      validationResult: {
        valid: true,
        communityName: 'Signal House',
      },
      authenticated: false,
      redeemBehavior: 'unused',
    }),
};

export const ExpiredLink: Story = {
  render: () =>
    renderInvite({
      token: 'expired-token',
      validationState: 'resolved',
      validationResult: {
        valid: false,
        error: 'expired',
      },
      authenticated: false,
      redeemBehavior: 'unused',
    }),
};

export const RedeemingAccess: Story = {
  render: () =>
    renderInvite({
      token: 'redeeming-token',
      validationState: 'resolved',
      validationResult: {
        valid: true,
        communityName: 'Signal House',
      },
      authenticated: true,
      redeemBehavior: 'pending',
    }),
};
