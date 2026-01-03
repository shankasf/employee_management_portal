import { createClient, createUntypedClient } from "@/lib/supabase/client";
import { Insertable, Updatable, MediaType } from "@/types/supabase";

// Get active policies (for employees)
export async function getActivePolicies() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

// Get all policies (for admin)
export async function getAllPolicies() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

// Get a single policy
export async function getPolicy(id: string) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as {
    id: string;
    title: string;
    content: string;
    category: string | null;
    is_active: boolean;
    image_url: string | null;
    video_url: string | null;
    media_type: MediaType | null;
    created_at: string;
    updated_at: string;
  };
}

// Create a new policy
export async function createPolicy(policy: Insertable<"policy_strips">) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .insert(policy)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update a policy
export async function updatePolicy(
  id: string,
  updates: Updatable<"policy_strips">
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete a policy
export async function deletePolicy(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("policy_strips").delete().eq("id", id);

  if (error) throw error;
}

// Toggle policy active status
export async function togglePolicyStatus(id: string, isActive: boolean) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .update({ is_active: isActive })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Get policy categories (unique)
export async function getPolicyCategories() {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .select("category")
    .not("category", "is", null);

  if (error) throw error;

  // Get unique categories
  interface PolicyCategory {
    category: string | null;
  }
  const categories = Array.from(
    new Set(data?.map((p: PolicyCategory) => p.category).filter(Boolean))
  );
  return categories;
}

// Upload policy media (image or video)
export async function uploadPolicyMedia(
  file: File,
  mediaType: 'image' | 'video'
): Promise<string> {
  const supabase = createClient();

  const fileExt = file.name.split('.').pop();
  const fileName = `${mediaType}-${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from('policy-media')
    .upload(fileName, file);

  if (uploadError) throw uploadError;

  const { data } = supabase.storage
    .from('policy-media')
    .getPublicUrl(fileName);

  return data.publicUrl;
}

// Delete policy media
export async function deletePolicyMedia(url: string) {
  const supabase = createClient();

  // Extract file path from URL
  const urlParts = url.split('/');
  const fileName = urlParts[urlParts.length - 1];

  const { error } = await supabase.storage
    .from('policy-media')
    .remove([fileName]);

  if (error) throw error;
}

// Create policy with media
export async function createPolicyWithMedia(
  policyData: {
    title: string;
    content: string;
    category?: string;
    is_active?: boolean;
  },
  mediaFile?: File,
  mediaType?: 'image' | 'video'
): Promise<ReturnType<typeof createPolicy>> {
  let imageUrl: string | null = null;
  let videoUrl: string | null = null;
  let policyMediaType: MediaType = 'none';

  if (mediaFile && mediaType) {
    const mediaUrl = await uploadPolicyMedia(mediaFile, mediaType);
    if (mediaType === 'image') {
      imageUrl = mediaUrl;
      policyMediaType = 'image';
    } else {
      videoUrl = mediaUrl;
      policyMediaType = 'video';
    }
  }

  return createPolicy({
    ...policyData,
    image_url: imageUrl,
    video_url: videoUrl,
    media_type: policyMediaType,
  });
}

// Update policy with media
export async function updatePolicyWithMedia(
  id: string,
  policyData: {
    title?: string;
    content?: string;
    category?: string;
    is_active?: boolean;
  },
  mediaFile?: File,
  mediaType?: 'image' | 'video',
  removeMedia?: boolean
): Promise<ReturnType<typeof updatePolicy>> {
  // Get existing policy to check for old media
  const existingPolicy = await getPolicy(id);

  let imageUrl = existingPolicy.image_url;
  let videoUrl = existingPolicy.video_url;
  let policyMediaType: MediaType = existingPolicy.media_type || 'none';

  // Remove existing media if requested or if replacing with new media
  if (removeMedia || mediaFile) {
    if (existingPolicy.image_url) {
      try {
        await deletePolicyMedia(existingPolicy.image_url);
      } catch (e) {
        console.error('Failed to delete old image:', e);
      }
      imageUrl = null;
    }
    if (existingPolicy.video_url) {
      try {
        await deletePolicyMedia(existingPolicy.video_url);
      } catch (e) {
        console.error('Failed to delete old video:', e);
      }
      videoUrl = null;
    }
    policyMediaType = 'none';
  }

  // Upload new media if provided
  if (mediaFile && mediaType) {
    const mediaUrl = await uploadPolicyMedia(mediaFile, mediaType);
    if (mediaType === 'image') {
      imageUrl = mediaUrl;
      policyMediaType = 'image';
    } else {
      videoUrl = mediaUrl;
      policyMediaType = 'video';
    }
  }

  return updatePolicy(id, {
    ...policyData,
    image_url: imageUrl,
    video_url: videoUrl,
    media_type: policyMediaType,
  });
}
