import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { uploadImageBuffer, deleteImage, generateUploadSignature } from '../lib/cloudinary.js';

const router = Router();

// Multer memory storage configuration (up to 10MB per file)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/svg+xml',
      'image/avif',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed types: JPG, PNG, WEBP, GIF, SVG, AVIF.`));
    }
  },
});

// Middleware to handle multer file upload with graceful error handling
const handleSingleUpload = (fieldName: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(fieldName)(req, res, (err: any) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Maximum size allowed is 10MB.' });
        }
        return res.status(400).json({ error: err.message });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  };
};

/**
 * POST /api/upload/image
 * Uploads an image file to Cloudinary and returns the hosted URLs.
 */
router.post('/image', handleSingleUpload('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided in form field "file"' });
    }

    const folder = (req.body.folder as string) || 'fittrock/products';
    const transformationOptions: Record<string, any> = {};

    // Optional quality optimization
    if (req.body.quality) {
      transformationOptions.quality = req.body.quality;
    }

    const result = await uploadImageBuffer(req.file.buffer, folder, transformationOptions);

    return res.status(200).json({
      success: true,
      url: result.url,
      secure_url: result.secureUrl,
      public_id: result.publicId,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
    });
  } catch (error: any) {
    console.error('Cloudinary Upload Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to upload image to Cloudinary',
    });
  }
});

/**
 * POST /api/upload/signature
 * Generates signed timestamp & signature for direct client-side uploads.
 */
router.post('/signature', async (req: Request, res: Response) => {
  try {
    const paramsToSign = req.body.paramsToSign || { folder: req.body.folder || 'fittrock/products' };
    const signedData = generateUploadSignature(paramsToSign);

    return res.status(200).json({
      success: true,
      ...signedData,
    });
  } catch (error: any) {
    console.error('Signature Generation Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to generate upload signature',
    });
  }
});

/**
 * DELETE /api/upload/image
 * Deletes an image from Cloudinary by public_id.
 */
router.delete('/image', async (req: Request, res: Response) => {
  try {
    const { public_id } = req.body;
    if (!public_id) {
      return res.status(400).json({ error: 'public_id is required to delete image' });
    }

    const result = await deleteImage(public_id);
    return res.status(200).json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error('Cloudinary Delete Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to delete image from Cloudinary',
    });
  }
});

export default router;
