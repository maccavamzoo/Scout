// YouTube Data API v3 helpers. Direct fetch — no googleapis package.

const API = 'https://www.googleapis.com/youtube/v3';

function key(): string {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error('YOUTUBE_API_KEY is not set');
  return k;
}

export interface YouTubeVideo {
  videoId: string;
  channelTitle: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  publishedAt: string;
  url: string;
}

// Resolve a handle (e.g. "@gcn") or free-text query to a channel ID.
export async function resolveChannelId(handleOrQuery: string): Promise<{ channelId: string; channelTitle: string } | null> {
  const q = handleOrQuery.trim();
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'channel',
    maxResults: '1',
    q,
    key: key(),
  });
  const res = await fetch(`${API}/search?${params}`);
  if (!res.ok) return null;
  const data = await res.json() as { items?: Array<{ snippet: { channelId: string; channelTitle: string } }> };
  const hit = data.items?.[0];
  if (!hit) return null;
  return { channelId: hit.snippet.channelId, channelTitle: hit.snippet.channelTitle };
}

// Fetch the uploads playlist ID for a channel.
async function uploadsPlaylistId(channelId: string): Promise<string | null> {
  const params = new URLSearchParams({
    part: 'contentDetails',
    id: channelId,
    key: key(),
  });
  const res = await fetch(`${API}/channels?${params}`);
  if (!res.ok) return null;
  const data = await res.json() as { items?: Array<{ contentDetails: { relatedPlaylists: { uploads: string } } }> };
  return data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
}

// Get videos in the last `hours` from a channel's uploads playlist.
export async function recentVideos(channelId: string, hours = 24): Promise<YouTubeVideo[]> {
  const playlistId = await uploadsPlaylistId(channelId);
  if (!playlistId) return [];

  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    playlistId,
    maxResults: '10',
    key: key(),
  });
  const res = await fetch(`${API}/playlistItems?${params}`);
  if (!res.ok) return [];
  const data = await res.json() as {
    items?: Array<{
      snippet: {
        title: string;
        description: string;
        channelTitle: string;
        thumbnails: Record<string, { url: string } | undefined>;
        publishedAt: string;
        resourceId: { videoId: string };
      };
      contentDetails: { videoPublishedAt?: string };
    }>;
  };

  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const videos: YouTubeVideo[] = [];
  for (const it of data.items ?? []) {
    const publishedAt = it.contentDetails.videoPublishedAt ?? it.snippet.publishedAt;
    if (Date.parse(publishedAt) < cutoff) continue;
    const videoId = it.snippet.resourceId.videoId;
    const thumb =
      it.snippet.thumbnails.maxres?.url ??
      it.snippet.thumbnails.standard?.url ??
      it.snippet.thumbnails.high?.url ??
      it.snippet.thumbnails.medium?.url ??
      it.snippet.thumbnails.default?.url ??
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    videos.push({
      videoId,
      channelTitle: it.snippet.channelTitle,
      title: it.snippet.title,
      description: it.snippet.description,
      thumbnailUrl: thumb,
      publishedAt,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }
  return videos;
}
