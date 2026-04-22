/**
 * Jazz CoValue schema. Shared state across tabs / devices via Jazz sync.
 * All realtime behavior (chat messages, typing, shared player state) lives here.
 */
import { co, z, Account, Group } from "jazz-tools";

export const Message = co.map({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  createdAt: z.number(),
  // Optional structured payload from the `watchVideo` tool, attached by the agent
  // so we can render a rich "file attachment" card in the chat.
  videoCard: z.optional(
    z.object({
      muxPlaybackId: z.string(),
      title: z.string(),
      summary: z.string(),
    }),
  ),
});
export type MessageT = co.loaded<typeof Message>;

export const MessageList = co.list(Message);

export const Conversation = co.map({
  agentId: z.string(),
  title: z.string(),
  messages: MessageList,
});
export type ConversationT = co.loaded<typeof Conversation>;

export const ConversationList = co.list(Conversation);

export const SpotifyLink = co.map({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  displayName: z.optional(z.string()),
  avatarUrl: z.optional(z.string()),
});

export const PlayerState = co.map({
  currentTrackId: z.optional(z.string()),
  currentTrackTitle: z.optional(z.string()),
  currentTrackArtist: z.optional(z.string()),
  isPlaying: z.boolean(),
  muxPlaybackId: z.optional(z.string()),
  mood: z.optional(z.string()),
  dominantColor: z.optional(z.string()),
  updatedAt: z.number(),
});

export const UserRoot = co.map({
  username: z.string(),
  conversations: ConversationList,
  spotify: co.optional(SpotifyLink),
  player: PlayerState,
});

export const XPAccount = co
  .account({
    root: UserRoot,
    profile: co.profile({ name: z.string() }),
  })
  .withMigration((account, creationProps) => {
    if (!account.$jazz.has("root")) {
      const group = Group.create({ owner: account });
      account.$jazz.set(
        "root",
        UserRoot.create(
          {
            username: creationProps?.name ?? "Anonymous",
            conversations: ConversationList.create([], group),
            player: PlayerState.create(
              { isPlaying: false, updatedAt: Date.now() },
              group,
            ),
          },
          group,
        ),
      );
    }
    if (!account.$jazz.has("profile")) {
      const publicGroup = Group.create({ owner: account });
      publicGroup.addMember("everyone", "reader");
      account.$jazz.set(
        "profile",
        co
          .profile({ name: z.string() })
          .create({ name: creationProps?.name ?? "Anonymous" }, publicGroup),
      );
    }
  });

export type XPAccountT = co.loaded<typeof XPAccount>;
