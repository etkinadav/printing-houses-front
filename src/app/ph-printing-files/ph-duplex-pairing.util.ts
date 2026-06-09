import { PhPrintingFile, PhPrintingFileImage } from './ph-printing-file.model';

export type DuplexPairSide = 'front' | 'back';

export interface PhDuplexPairing {
  pairIndex: number;
  side: DuplexPairSide;
  partnerFileId: string | null;
  partnerImageId: string | null;
  globalOrderIndex: number;
  isPlaceholderPartner: boolean;
}

export interface DuplexFlatPageRef {
  file: PhPrintingFile;
  image: PhPrintingFileImage;
  imageIndex: number;
  globalOrderIndex: number;
}

export interface DuplexPairSideEntry {
  file: PhPrintingFile;
  image: PhPrintingFileImage;
  imageIndex: number;
}

export interface DuplexPairDisplayEntry {
  pairIndex: number;
  front: DuplexPairSideEntry;
  back: DuplexPairSideEntry | null;
  isIncomplete: boolean;
}

function compareFilesForPairing(a: PhPrintingFile, b: PhPrintingFile): number {
  const aCreated = a.created ? new Date(a.created).getTime() : 0;
  const bCreated = b.created ? new Date(b.created).getTime() : 0;
  if (aCreated !== bCreated) {
    return aCreated - bCreated;
  }
  return a._id.localeCompare(b._id);
}

export function flattenReadyPages(files: PhPrintingFile[]): DuplexFlatPageRef[] {
  const sorted = [...files].sort(compareFilesForPairing);
  const pages: DuplexFlatPageRef[] = [];

  for (const file of sorted) {
    if (file.processing || !(file.images?.length > 0)) {
      continue;
    }
    for (let imageIndex = 0; imageIndex < file.images.length; imageIndex += 1) {
      const image = file.images[imageIndex];
      pages.push({
        file,
        image,
        imageIndex,
        globalOrderIndex: pages.length,
      });
    }
  }

  return pages;
}

export function buildDuplexPairDisplayEntries(
  files: PhPrintingFile[],
): DuplexPairDisplayEntry[] {
  const pages = flattenReadyPages(files);
  const pairs: DuplexPairDisplayEntry[] = [];

  for (let i = 0; i < pages.length; i += 2) {
    const front = pages[i];
    const back = pages[i + 1] ?? null;
    pairs.push({
      pairIndex: Math.floor(i / 2),
      front: {
        file: front.file,
        image: front.image,
        imageIndex: front.imageIndex,
      },
      back: back
        ? {
            file: back.file,
            image: back.image,
            imageIndex: back.imageIndex,
          }
        : null,
      isIncomplete: !back,
    });
  }

  return pairs;
}

export function findDuplexPartnerSide(
  files: PhPrintingFile[],
  fileId: string,
  imageId: string,
): DuplexPairSideEntry | null {
  for (const file of files) {
    if (file._id !== fileId) {
      continue;
    }
    const imageIndex = file.images.findIndex((img) => img._id === imageId);
    if (imageIndex < 0) {
      return null;
    }
    const pairing = file.images[imageIndex].duplexPairing;
    if (!pairing?.partnerFileId || !pairing.partnerImageId) {
      return null;
    }
    const partnerFile = files.find((f) => f._id === pairing.partnerFileId);
    if (!partnerFile) {
      return null;
    }
    const partnerIndex = partnerFile.images.findIndex(
      (img) => img._id === pairing.partnerImageId,
    );
    if (partnerIndex < 0) {
      return null;
    }
    return {
      file: partnerFile,
      image: partnerFile.images[partnerIndex],
      imageIndex: partnerIndex,
    };
  }
  return null;
}

export function findDuplexPairForSide(
  pairs: DuplexPairDisplayEntry[],
  fileId: string,
  imageId: string,
): DuplexPairDisplayEntry | null {
  for (const pair of pairs) {
    if (
      pair.front.file._id === fileId &&
      pair.front.image._id === imageId
    ) {
      return pair;
    }
    if (
      pair.back &&
      pair.back.file._id === fileId &&
      pair.back.image._id === imageId
    ) {
      return pair;
    }
  }
  return null;
}
