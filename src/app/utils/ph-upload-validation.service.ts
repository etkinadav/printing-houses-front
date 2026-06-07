import { Injectable } from '@angular/core';

import { DialogService } from '../dialog/dialog.service';
import {
  ALLOWED_EXTENSIONS_EXPRESS,
  getExpressFileSizeMb,
  getFileExtension,
  isExpressFileTooLarge,
  isExpressFileTypeAllowed,
} from './ph-express-upload';

const DEFAULT_SUPPORT_PHONE = '97233746962';

@Injectable({ providedIn: 'root' })
export class PhUploadValidationService {
  constructor(private dialogService: DialogService) {}

  /** Returns true when the file may be uploaded. */
  validateExpressUpload(file: File, phoneNumber = DEFAULT_SUPPORT_PHONE): boolean {
    if (!isExpressFileTypeAllowed(file.name)) {
      this.dialogService.onOpenFileIssuesDialog(
        file.name,
        [...ALLOWED_EXTENSIONS_EXPRESS],
        phoneNumber,
        'file-format-not-supported',
        {
          fileFormat: getFileExtension(file.name),
          printingService: 'express',
        },
      );
      return false;
    }

    if (isExpressFileTooLarge(file)) {
      this.dialogService.onOpenFileIssuesDialog(
        file.name,
        [...ALLOWED_EXTENSIONS_EXPRESS],
        phoneNumber,
        'file-too-large',
        { fileSizeMb: getExpressFileSizeMb(file) },
      );
      return false;
    }

    return true;
  }
}
