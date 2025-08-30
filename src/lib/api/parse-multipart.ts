import type { NextApiRequest } from 'next';
import type { File as FormidableFile, Fields, Files, Options as FormidableOptions } from 'formidable';

export type ParsedForm = {
  fields: Fields;
  files: Files;
};

export const isMultipart = (req: NextApiRequest): boolean => {
  const ct = req.headers['content-type'] || '';
  return typeof ct === 'string' && ct.toLowerCase().includes('multipart/form-data');
};

export async function parseMultipart(req: NextApiRequest, opts?: FormidableOptions): Promise<ParsedForm> {
  const formidable: typeof import('formidable') = require('formidable');
  const form = formidable({
    multiples: false,
    keepExtensions: true,
    ...opts,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err: any, fields: Fields, files: Files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

export type FormFile = FormidableFile;
