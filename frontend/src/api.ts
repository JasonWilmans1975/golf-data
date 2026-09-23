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

// A phone camera photo straight off the device is often 5-10MB, and it has
// to travel twice (browser -> our backend -> Supabase Storage). Downscaling
// and re-compressing client-side before upload cuts that dramatically --
// there's no reason to ship a 4000px-wide photo for a card that displays at
// a few hundred px.
function compressImage(file: File, maxDimension = 1600, quality = 0.82): Promise<File> {
    return new Promise((resolve) => {
        if (!file.type.startsWith("image/") || file.type === "image/gif") {
            resolve(file);
            return;
        }

        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);

            let { width, height } = img;

            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                } else {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");

            if (!ctx) {
                resolve(file);
                return;
            }

            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (!blob || blob.size >= file.size) {
                        resolve(file);
                        return;
                    }

                    resolve(
                        new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
                            type: "image/jpeg",
                        })
                    );
                },
                "image/jpeg",
                quality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(file);
        };

        img.src = objectUrl;
    });
}

export async function uploadCoursePhoto(courseId: number, file: File) {
    const compressed = await compressImage(file);

    const formData = new FormData();
    formData.append("file", compressed);

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
    const compressed = await compressImage(file);

    const formData = new FormData();
    formData.append("file", compressed);

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
