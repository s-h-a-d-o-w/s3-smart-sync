import { S3Client } from "@aws-sdk/client-s3";
import { ACCESS_KEY, AWS_REGION, SECRET_KEY } from "./consts.js";

export const ignoreFiles = new Set();

export const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});
