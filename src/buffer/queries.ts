export const ACCOUNT_QUERY = /* GraphQL */ `
  query PostGuardAccount {
    account {
      id
      organizations {
        id
        name
      }
    }
  }
`;

export const CHANNELS_QUERY = /* GraphQL */ `
  query PostGuardChannels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      name
      displayName
      service
      isDisconnected
      isLocked
      isQueuePaused
      timezone
      metadata {
        __typename
        ... on MastodonMetadata {
          maxCharacters
        }
        ... on TwitterMetadata {
          subscriptionType
        }
      }
    }
  }
`;

const POST_FIELDS = /* GraphQL */ `
  id
  text
  status
  dueAt
  channelId
  channelService
  schedulingType
  error {
    message
  }
  assets {
    __typename
    mimeType
    source
    thumbnail
    type
    ... on ImageAsset {
      image {
        altText
        width
        height
      }
    }
    ... on VideoAsset {
      video {
        width
        height
        durationMs
      }
    }
  }
  metadata {
    __typename
    ... on InstagramPostMetadata {
      type
      firstComment
      link
      annotations {
        type
        url
        text
      }
    }
    ... on FacebookPostMetadata {
      type
      firstComment
      title
      linkAttachment {
        url
        expandedUrl
      }
      annotations {
        type
        url
        text
      }
    }
    ... on LinkedInPostMetadata {
      type
      firstComment
      linkAttachment {
        url
        expandedUrl
      }
      annotations {
        type
        url
        text
      }
    }
    ... on PinterestPostMetadata {
      type
      title
      url
      annotations {
        type
        url
        text
      }
    }
    ... on YoutubePostMetadata {
      type
      title
      annotations {
        type
        url
        text
      }
    }
    ... on ThreadsPostMetadata {
      type
      topic
      linkAttachment {
        url
        expandedUrl
      }
      thread {
        text
      }
      annotations {
        type
        url
        text
      }
    }
    ... on TwitterPostMetadata {
      type
      thread {
        text
      }
      annotations {
        type
        url
        text
      }
    }
    ... on BlueskyPostMetadata {
      type
      thread {
        text
      }
      linkAttachment {
        url
        expandedUrl
      }
      annotations {
        type
        url
        text
      }
    }
    ... on MastodonPostMetadata {
      type
      thread {
        text
      }
      annotations {
        type
        url
        text
      }
    }
    ... on TiktokPostMetadata {
      type
      title
      annotations {
        type
        url
        text
      }
    }
    ... on GoogleBusinessPostMetadata {
      type
      title
      annotations {
        type
        url
        text
      }
    }
    ... on SubstackPostMetadata {
      type
      linkAttachment {
        url
        expandedUrl
      }
      annotations {
        type
        url
        text
      }
    }
  }
`;

export const POSTS_QUERY = /* GraphQL */ `
  query PostGuardPosts(
    $organizationId: OrganizationId!
    $after: String
    $first: Int!
    $start: DateTime!
    $end: DateTime!
    $statuses: [PostStatus!]!
  ) {
    posts(
      first: $first
      after: $after
      input: {
        organizationId: $organizationId
        sort: [{ field: dueAt, direction: asc }]
        filter: { status: $statuses, dueAt: { start: $start, end: $end } }
      }
    ) {
      edges {
        node {
          ${POST_FIELDS}
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const UNDATED_POSTS_QUERY = /* GraphQL */ `
  query PostGuardUndatedPosts($organizationId: OrganizationId!, $first: Int!, $statuses: [PostStatus!]!) {
    posts(
      first: $first
      input: {
        organizationId: $organizationId
        filter: { status: $statuses, dueAtPresence: absent }
      }
    ) {
      edges {
        node {
          ${POST_FIELDS}
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/** Drafts can sit outside the date window, so they are a separate page when the reader opts in. */
export const DRAFTS_QUERY = /* GraphQL */ `
  query PostGuardDrafts($organizationId: OrganizationId!, $first: Int!) {
    posts(
      first: $first
      input: {
        organizationId: $organizationId
        sort: [{ field: createdAt, direction: desc }]
        filter: { status: [draft] }
      }
    ) {
      edges {
        node {
          ${POST_FIELDS}
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
