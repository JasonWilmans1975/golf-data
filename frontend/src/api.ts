import L from "leaflet";
import { supabase } from "./supabaseClient";

export const API = import.meta.env.VITE_API_URL as string;

export async function authFetch(url: string, options: RequestInit = {}) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    return fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
}

export async function uploadCoursePhoto(courseId: number, file: File) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await authFetch(`${API}/courses/${courseId}/photo`, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        throw new Error("Failed to upload course photo");
    }

    return (await response.json()) as { photo_url: string };
}

export async function uploadPostPhoto(file: File) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await authFetch(`${API}/feed/posts/photo`, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        throw new Error("Failed to upload photo");
    }

    return (await response.json()) as { photo_url: string };
}

export function courseMarkerIcon(course: {
    name: string;
    photo_url?: string | null;
}) {
    const photoHtml = course.photo_url
        ? `<div class="avatar-marker-photo" style="background-image: url('${course.photo_url}')"></div>`
        : `<div class="avatar-marker-photo avatar-marker-placeholder">${course.name
            .charAt(0)
            .toUpperCase()}</div>`;

    return L.divIcon({
        className: "avatar-marker",
        html: `${photoHtml}<div class="avatar-marker-point"></div>`,
        iconSize: [44, 56],
        iconAnchor: [22, 56],
        popupAnchor: [0, -48],
    });
}
