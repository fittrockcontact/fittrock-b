import { v2 as cloudinary, UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export interface UploadResult {
  url: string;
  secureUrl: string;
  publicId: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Upload an image buffer directly to Cloudinary using streaming upload.
 */
export async function uploadImageBuffer(
  buffer: Buffer,
  folder: string = 'fittrock/products',
  options: Record<string, any> = {}
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        ...options,
      },
      (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
        if (error || !result) {
          return reject(error || new Error('Upload to Cloudinary failed with empty result.'));
        }
        resolve({
          url: result.url,
          secureUrl: result.secure_url,
          publicId: result.public_id,
          format: result.format,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
        });
      }
    );

    uploadStream.end(buffer);
  });
}

/**
 * Delete an image from Cloudinary by its public ID.
 */
export async function deleteImage(publicId: string): Promise<{ result: string }> {
  return cloudinary.uploader.destroy(publicId);
}

/**
 * Generate a signed upload signature for direct frontend uploads to Cloudinary.
 */
export function generateUploadSignature(paramsToSign: Record<string, any>): {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
} {
  const timestamp = Math.round(new Date().getTime() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    { ...paramsToSign, timestamp },
    process.env.CLOUDINARY_API_SECRET || ''
  );

  return {
    signature,
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  };
}

export { cloudinary };
