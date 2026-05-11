import type {ConvexClient, ConnectionState} from 'convex/browser';
import type {FunctionArgs, FunctionReference} from 'convex/server';

const STORY_NO_QUERY_UPDATE = Symbol('STORY_NO_QUERY_UPDATE');

type StoryQueryReference = FunctionReference<'query'>;
type StoryMutationReference = FunctionReference<'mutation'>;
type StoryActionReference = FunctionReference<'action'>;

interface StoryOnUpdateContext<Query extends StoryQueryReference> {
  query: Query;
  args: FunctionArgs<Query>;
}

interface StoryMutationContext<Mutation extends StoryMutationReference> {
  mutation: Mutation;
  args: FunctionArgs<Mutation>;
}

interface StoryActionContext<Action extends StoryActionReference> {
  action: Action;
  args: FunctionArgs<Action>;
}

export interface StoryConvexClientConfig {
  onUpdate?: <Query extends StoryQueryReference>(
    context: StoryOnUpdateContext<Query>,
  ) => unknown;
  query?: <Query extends StoryQueryReference>(
    context: StoryOnUpdateContext<Query>,
  ) => unknown;
  mutation?: <Mutation extends StoryMutationReference>(
    context: StoryMutationContext<Mutation>,
  ) => unknown;
  action?: <Action extends StoryActionReference>(
    context: StoryActionContext<Action>,
  ) => unknown;
  hasAuth?: () => boolean;
}

type StoryBaseConvexClient = Pick<
  ConvexClient['client'],
  | 'clearAuth'
  | 'connectionState'
  | 'hasAuth'
  | 'localQueryResult'
  | 'setAuth'
  | 'subscribeToConnectionState'
>;
type StoryUnsubscribe = ReturnType<ConvexClient['onUpdate']>;

export type StoryConvexClient = Pick<
  ConvexClient,
  | 'action'
  | 'close'
  | 'connectionState'
  | 'getAuth'
  | 'mutation'
  | 'onPaginatedUpdate_experimental'
  | 'onUpdate'
  | 'query'
  | 'setAuth'
  | 'subscribeToConnectionState'
> & {
  readonly client: StoryBaseConvexClient;
  handleAuthError: () => void;
};

const DEFAULT_CONNECTION_STATE = {
  hasInflightRequests: false,
  isWebSocketConnected: false,
  timeOfOldestInflightRequest: null,
  hasEverConnected: true,
  connectionCount: 1,
  connectionRetries: 0,
  inflightMutations: 0,
  inflightActions: 0,
} satisfies ConnectionState;

function createStoryUnsubscribe(value?: unknown): StoryUnsubscribe {
  const unsubscribe = (() => undefined) as StoryUnsubscribe;
  unsubscribe.unsubscribe = () => undefined;
  unsubscribe.getCurrentValue = () => value;
  return unsubscribe;
}

export function skipStoryConvexQueryUpdate(): typeof STORY_NO_QUERY_UPDATE {
  return STORY_NO_QUERY_UPDATE;
}

export function createStoryConvexClient(
  config: StoryConvexClientConfig = {},
): StoryConvexClient {
  const hasAuth = (): boolean => config.hasAuth?.() ?? false;
  const connectionState = (): ConnectionState => DEFAULT_CONNECTION_STATE;
  const subscribeToConnectionState: StoryConvexClient['subscribeToConnectionState'] =
    () => () => undefined;
  const setAuth: StoryConvexClient['setAuth'] = (_fetchToken, onChange) => {
    onChange?.(hasAuth());
  };
  const clearAuth: StoryBaseConvexClient['clearAuth'] = () => undefined;

  const onUpdate = ((query, args, onData) => {
    const result = config.onUpdate ? config.onUpdate({query, args}) : null;
    if (result !== STORY_NO_QUERY_UPDATE) {
      onData(result);
    }

    return createStoryUnsubscribe(result);
  }) as StoryConvexClient['onUpdate'];

  const query = ((queryReference, args) =>
    Promise.resolve(
      config.query ? config.query({query: queryReference, args}) : null,
    )) as StoryConvexClient['query'];

  const mutation = ((mutationReference, args) =>
    Promise.resolve(
      config.mutation
        ? config.mutation({mutation: mutationReference, args})
        : null,
    )) as StoryConvexClient['mutation'];

  const action = ((actionReference, args) =>
    Promise.resolve(
      config.action ? config.action({action: actionReference, args}) : null,
    )) as StoryConvexClient['action'];

  const localQueryResult: StoryBaseConvexClient['localQueryResult'] = () =>
    undefined;

  return {
    query,
    mutation,
    action,
    onUpdate,
    onPaginatedUpdate_experimental: (() =>
      createStoryUnsubscribe()) as StoryConvexClient['onPaginatedUpdate_experimental'],
    connectionState,
    subscribeToConnectionState,
    setAuth,
    getAuth: () => undefined,
    close: () => Promise.resolve(),
    handleAuthError: () => undefined,
    client: {
      localQueryResult,
      connectionState,
      subscribeToConnectionState,
      hasAuth,
      setAuth,
      clearAuth,
    },
  };
}
