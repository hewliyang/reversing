import { ProtobufReader } from "./protobuf-reader.mjs";

function readMessage(reader, decode) {
  const length = reader.uint32();
  const end = reader.pos + length;
  const value = decode(reader, end);
  reader.pos = end;
  return value;
}

function decodeCell(reader, end) {
  const cell = {
    address: "",
    value: undefined,
    formula: undefined,
    dataType: 0,
    styleIndex: undefined,
    paragraphs: [],
    textStyle: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        cell.address = reader.string();
        break;
      case 2:
        cell.value = reader.string();
        break;
      case 3:
        cell.formula = reader.string();
        break;
      case 4:
        cell.dataType = reader.int32();
        break;
      case 5:
        cell.styleIndex = reader.int32();
        break;
      case 6:
        cell.paragraphs.push(readMessage(reader, decodeRichParagraph));
        break;
      case 7:
        cell.textStyle = readMessage(reader, decodeRichTextStyle);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return cell;
}

function decodeRichTextStyle(reader, end) {
  const style = {
    bold: undefined,
    italic: undefined,
    fontSize: undefined,
    fill: undefined,
    alignment: undefined,
    underline: undefined,
    name: undefined,
    scheme: undefined,
    typeface: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 4:
        style.bold = reader.bool();
        break;
      case 5:
        style.italic = reader.bool();
        break;
      case 6:
        style.fontSize = reader.int32();
        break;
      case 7:
        style.fill = readMessage(reader, decodeFill);
        break;
      case 8:
        style.alignment = reader.int32();
        break;
      case 9:
        style.underline = reader.string();
        break;
      case 15:
        style.name = reader.string();
        break;
      case 17:
        style.scheme = reader.string();
        break;
      case 18:
        style.typeface = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return style;
}

function decodeRichTextRun(reader, end) {
  const run = {
    text: "",
    textStyle: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        run.text = reader.string();
        break;
      case 2:
        run.textStyle = readMessage(reader, decodeRichTextStyle);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return run;
}

function decodeRichParagraph(reader, end) {
  const paragraph = {
    runs: [],
    textStyle: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        paragraph.runs.push(readMessage(reader, decodeRichTextRun));
        break;
      case 2:
        paragraph.textStyle = readMessage(reader, decodeRichTextStyle);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return paragraph;
}

function decodeRow(reader, end) {
  const row = {
    index: 0,
    cells: [],
    height: 0,
    customHeight: false,
    styleIndex: undefined,
    hidden: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        row.index = reader.int32();
        break;
      case 2:
        row.cells.push(readMessage(reader, decodeCell));
        break;
      case 3:
        row.height = reader.float();
        break;
      case 4:
        row.customHeight = reader.bool();
        break;
      case 5:
        row.styleIndex = reader.int32();
        break;
      case 6:
        row.hidden = reader.bool();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return row;
}

function decodeColumn(reader, end) {
  const column = {
    min: 0,
    max: 0,
    width: 0,
    customWidth: false,
    styleIndex: undefined,
    hidden: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        column.min = reader.int32();
        break;
      case 2:
        column.max = reader.int32();
        break;
      case 3:
        column.width = reader.float();
        break;
      case 4:
        column.customWidth = reader.bool();
        break;
      case 5:
        column.styleIndex = reader.int32();
        break;
      case 6:
        column.hidden = reader.bool();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return column;
}

function decodeColorTransform(reader, end) {
  const transform = {
    tint: undefined,
    shade: undefined,
    lumMod: undefined,
    lumOff: undefined,
    satMod: undefined,
    alpha: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        transform.tint = reader.int32();
        break;
      case 2:
        transform.shade = reader.int32();
        break;
      case 3:
        transform.lumMod = reader.int32();
        break;
      case 4:
        transform.lumOff = reader.int32();
        break;
      case 5:
        transform.satMod = reader.int32();
        break;
      case 6:
        transform.alpha = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return transform;
}

function decodeColor(reader, end) {
  const color = {
    type: 0,
    value: "",
    transform: undefined,
    lastColor: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        color.type = reader.int32();
        break;
      case 2:
        color.value = reader.string();
        break;
      case 3:
        color.transform = readMessage(reader, decodeColorTransform);
        break;
      case 4:
        color.lastColor = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return color;
}

function decodeFill(reader, end) {
  const fill = {
    type: 0,
    color: undefined,
    gradientStops: [],
    gradientKind: undefined,
    angleDeg: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        fill.type = reader.int32();
        break;
      case 2:
        fill.color = readMessage(reader, decodeColor);
        break;
      case 3:
        fill.gradientStops.push(readMessage(reader, decodeGradientStop));
        break;
      case 5:
        fill.gradientKind = reader.int32();
        break;
      case 6:
        fill.angleDeg = reader.double();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return fill;
}

function decodeGradientStop(reader, end) {
  const stop = {
    position: undefined,
    color: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        stop.position = reader.int32();
        break;
      case 2:
        stop.color = readMessage(reader, decodeColor);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return stop;
}

function decodeFont(reader, end) {
  const font = {
    bold: undefined,
    italic: undefined,
    fontSize: undefined,
    fill: undefined,
    underline: undefined,
    name: undefined,
    scheme: undefined,
    typeface: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 4:
        font.bold = reader.bool();
        break;
      case 5:
        font.italic = reader.bool();
        break;
      case 6:
        font.fontSize = reader.int32();
        break;
      case 7:
        font.fill = readMessage(reader, decodeFill);
        break;
      case 9:
        font.underline = reader.string();
        break;
      case 15:
        font.name = reader.string();
        break;
      case 17:
        font.scheme = reader.string();
        break;
      case 18:
        font.typeface = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return font;
}

function decodeBorderLine(reader, end) {
  const line = {
    style: "",
    color: undefined,
    indexedColorId: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        line.style = reader.string();
        break;
      case 2:
        line.color = readMessage(reader, decodeColor);
        break;
      case 3:
        line.indexedColorId = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return line;
}

function decodeBorder(reader, end) {
  const border = {};

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        border.left = readMessage(reader, decodeBorderLine);
        break;
      case 2:
        border.right = readMessage(reader, decodeBorderLine);
        break;
      case 3:
        border.top = readMessage(reader, decodeBorderLine);
        break;
      case 4:
        border.bottom = readMessage(reader, decodeBorderLine);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return border;
}

function decodeNumberFormat(reader, end) {
  const numberFormat = {
    id: 0,
    formatCode: "",
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        numberFormat.id = reader.int32();
        break;
      case 2:
        numberFormat.formatCode = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return numberFormat;
}

function decodeCellFormat(reader, end) {
  const format = {
    numFmtId: undefined,
    fontId: undefined,
    fillId: undefined,
    borderId: undefined,
    xfId: undefined,
    applyFill: undefined,
    applyFont: undefined,
    applyBorder: undefined,
    horizontalAlignment: undefined,
    verticalAlignment: undefined,
    applyNumberFormat: undefined,
    wrapText: undefined,
    shrinkToFit: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        format.numFmtId = reader.int32();
        break;
      case 2:
        format.fontId = reader.int32();
        break;
      case 3:
        format.fillId = reader.int32();
        break;
      case 4:
        format.borderId = reader.int32();
        break;
      case 5:
        format.xfId = reader.int32();
        break;
      case 6:
        format.applyFill = reader.bool();
        break;
      case 7:
        format.applyFont = reader.bool();
        break;
      case 8:
        format.applyBorder = reader.bool();
        break;
      case 10:
        format.horizontalAlignment = reader.string();
        break;
      case 11:
        format.verticalAlignment = reader.string();
        break;
      case 12:
        format.applyNumberFormat = reader.bool();
        break;
      case 14:
        format.wrapText = reader.bool();
        break;
      case 15:
        format.shrinkToFit = reader.bool();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return format;
}

function decodeDifferentialFormat(reader, end) {
  const format = {
    font: undefined,
    fill: undefined,
    border: undefined,
    numberFormat: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        format.font = readMessage(reader, decodeFont);
        break;
      case 2:
        format.fill = readMessage(reader, decodeFill);
        break;
      case 3:
        format.border = readMessage(reader, decodeBorder);
        break;
      case 4:
        format.numberFormat = readMessage(reader, decodeNumberFormat);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return format;
}

function decodeStyles(reader, end) {
  const styles = {
    fonts: [],
    fills: [],
    cellXfs: [],
    borders: [],
    numberFormats: [],
    dxfs: [],
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        styles.fonts.push(readMessage(reader, decodeFont));
        break;
      case 2:
        styles.fills.push(readMessage(reader, decodeFill));
        break;
      case 3:
        styles.cellXfs.push(readMessage(reader, decodeCellFormat));
        break;
      case 4:
        styles.borders.push(readMessage(reader, decodeBorder));
        break;
      case 7:
        styles.numberFormats.push(readMessage(reader, decodeNumberFormat));
        break;
      case 8:
        styles.dxfs.push(readMessage(reader, decodeDifferentialFormat));
        break;
      default:
        reader.skip(wireType);
    }
  }

  return styles;
}

function decodeRange(reader, end) {
  const range = {
    sheetName: "",
    sheetId: undefined,
    startAddress: "",
    endAddress: "",
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        range.sheetName = reader.string();
        break;
      case 2:
        range.sheetId = reader.string();
        break;
      case 3:
        range.startAddress = reader.string();
        break;
      case 4:
        range.endAddress = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return range;
}

function decodeImage(reader, end) {
  const image = {
    contentType: "",
    data: new Uint8Array(),
    id: "",
    prompt: undefined,
    uri: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        image.contentType = reader.string();
        break;
      case 2:
        image.data = reader.bytesValue();
        break;
      case 3:
        image.id = reader.string();
        break;
      case 4:
        image.prompt = reader.string();
        break;
      case 5:
        image.uri = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return image;
}

function decodeImageReference(reader, end) {
  const imageReference = { id: "" };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        imageReference.id = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return imageReference;
}

function decodeAnchorMarker(reader, end) {
  const anchor = {
    rowId: "",
    colId: "",
    colOffset: "",
    rowOffset: "",
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        anchor.rowId = reader.string();
        break;
      case 2:
        anchor.colId = reader.string();
        break;
      case 3:
        anchor.colOffset = reader.string();
        break;
      case 4:
        anchor.rowOffset = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return anchor;
}

function decodeDrawing(reader, end) {
  const drawing = {
    fromAnchor: undefined,
    toAnchor: undefined,
    chart: undefined,
    imageReference: undefined,
    extentCx: undefined,
    extentCy: undefined,
    shape: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        drawing.fromAnchor = readMessage(reader, decodeAnchorMarker);
        break;
      case 2:
        drawing.toAnchor = readMessage(reader, decodeAnchorMarker);
        break;
      case 3:
        drawing.chart = readMessage(reader, decodeChart);
        break;
      case 4:
        drawing.imageReference = readMessage(reader, decodeImageReference);
        break;
      case 5:
        drawing.extentCx = reader.string();
        break;
      case 6:
        drawing.extentCy = reader.string();
        break;
      case 7:
        drawing.shape = readMessage(reader, decodeElement);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return drawing;
}

function decodePptxLine(reader, end) {
  const line = {
    style: undefined,
    widthEmu: undefined,
    fill: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        line.style = reader.int32();
        break;
      case 2:
        line.widthEmu = reader.int32();
        break;
      case 3:
        line.fill = readMessage(reader, decodeFill);
        break;
      default:
        reader.skip(wireType);
    }
  }
  return line;
}

function decodeShapeElement(reader, end) {
  const shape = {
    geometry: undefined,
    fill: undefined,
    line: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        shape.geometry = reader.int32();
        break;
      case 5:
        shape.fill = readMessage(reader, decodeFill);
        break;
      case 6:
        shape.line = readMessage(reader, decodePptxLine);
        break;
      default:
        reader.skip(wireType);
    }
  }
  return shape;
}

function decodeTextRun(reader, end) {
  const run = { text: "" };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        run.text = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return run;
}

function decodeParagraph(reader, end) {
  const paragraph = { runs: [] };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        paragraph.runs.push(readMessage(reader, decodeTextRun));
        break;
      default:
        reader.skip(wireType);
    }
  }
  return paragraph;
}

function decodeElement(reader, end) {
  const element = {
    zIndex: undefined,
    imageReference: undefined,
    shape: undefined,
    paragraphs: [],
    name: undefined,
    type: undefined,
    fill: undefined,
    line: undefined,
    id: undefined,
    children: [],
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 2:
        element.zIndex = reader.int32();
        break;
      case 3:
        element.imageReference = readMessage(reader, decodeImageReference);
        break;
      case 4:
        element.shape = readMessage(reader, decodeShapeElement);
        break;
      case 6:
        element.paragraphs.push(readMessage(reader, decodeParagraph));
        break;
      case 10:
        element.name = reader.string();
        break;
      case 11:
        element.type = reader.int32();
        break;
      case 17:
        element.children.push(readMessage(reader, decodeElement));
        break;
      case 19:
        element.fill = readMessage(reader, decodeFill);
        break;
      case 27:
        element.id = reader.string();
        break;
      case 30:
        element.line = readMessage(reader, decodePptxLine);
        break;
      default:
        reader.skip(wireType);
    }
  }
  return element;
}

function decodeTextBody(reader, end) {
  const body = { plainText: "" };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        body.plainText = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return body;
}

function decodePerson(reader, end) {
  const person = {
    id: "",
    displayName: "",
    email: undefined,
    avatarUrl: undefined,
    type: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        person.id = reader.string();
        break;
      case 2:
        person.displayName = reader.string();
        break;
      case 3:
        person.email = reader.string();
        break;
      case 4:
        person.avatarUrl = reader.string();
        break;
      case 5:
        person.type = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return person;
}

function decodeCellTarget(reader, end) {
  const target = {
    sheetName: "",
    sheetId: undefined,
    address: "",
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        target.sheetName = reader.string();
        break;
      case 2:
        target.sheetId = reader.string();
        break;
      case 3:
        target.address = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return target;
}

function decodeAnnotationTarget(reader, end) {
  const target = {
    cell: undefined,
    range: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        target.cell = readMessage(reader, decodeCellTarget);
        break;
      case 2:
        target.range = readMessage(reader, decodeRange);
        break;
      default:
        reader.skip(wireType);
    }
  }
  return target;
}

function decodeComment(reader, end) {
  const comment = {
    id: "",
    parentId: undefined,
    authorId: "",
    createdAt: "",
    editedAt: undefined,
    body: undefined,
    isDeleted: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        comment.id = reader.string();
        break;
      case 2:
        comment.parentId = reader.string();
        break;
      case 3:
        comment.authorId = reader.string();
        break;
      case 4:
        comment.createdAt = reader.string();
        break;
      case 5:
        comment.editedAt = reader.string();
        break;
      case 6:
        comment.body = readMessage(reader, decodeTextBody);
        break;
      case 7:
        comment.isDeleted = reader.bool();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return comment;
}

function decodeThread(reader, end) {
  const thread = {
    id: "",
    target: undefined,
    comments: [],
    resolved: undefined,
    resolvedBy: undefined,
    resolvedAt: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        thread.id = reader.string();
        break;
      case 2:
        thread.target = readMessage(reader, decodeAnnotationTarget);
        break;
      case 3:
        thread.comments.push(readMessage(reader, decodeComment));
        break;
      case 4:
        thread.resolved = reader.bool();
        break;
      case 5:
        thread.resolvedBy = reader.string();
        break;
      case 6:
        thread.resolvedAt = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return thread;
}

function decodeNote(reader, end) {
  const note = {
    id: "",
    target: undefined,
    authorId: "",
    createdAt: "",
    body: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        note.id = reader.string();
        break;
      case 2:
        note.target = readMessage(reader, decodeAnnotationTarget);
        break;
      case 3:
        note.authorId = reader.string();
        break;
      case 4:
        note.createdAt = reader.string();
        break;
      case 5:
        note.body = readMessage(reader, decodeTextBody);
        break;
      default:
        reader.skip(wireType);
    }
  }
  return note;
}

function readRepeatedDouble(reader, wireType) {
  if (wireType === 1) return [reader.double()];
  if (wireType !== 2) {
    reader.skip(wireType);
    return [];
  }
  const length = reader.uint32();
  const end = reader.pos + length;
  const values = [];
  while (!reader.eof(end)) values.push(reader.double());
  reader.pos = end;
  return values;
}

function decodeChartSeries(reader, end) {
  const series = {
    name: "",
    values: [],
    formula: "",
    stringCache: "",
    categories: [],
    categoryFormula: "",
    id: undefined,
    xValues: [],
    xFormula: undefined,
    bubbleSizes: [],
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        series.name = reader.string();
        break;
      case 2:
        series.values.push(...readRepeatedDouble(reader, wireType));
        break;
      case 3:
        series.formula = reader.string();
        break;
      case 4:
        series.stringCache = reader.string();
        break;
      case 5:
        series.categories.push(reader.string());
        break;
      case 6:
        series.categoryFormula = reader.string();
        break;
      case 8:
        series.id = reader.string();
        break;
      case 17:
        series.xValues.push(...readRepeatedDouble(reader, wireType));
        break;
      case 18:
        series.xFormula = reader.string();
        break;
      case 20:
        series.bubbleSizes.push(...readRepeatedDouble(reader, wireType));
        break;
      default:
        reader.skip(wireType);
    }
  }

  return series;
}

function decodeChart(reader, end) {
  const chart = {
    title: "",
    categories: [],
    series: [],
    type: 0,
    styleIndex: 0,
    id: "",
    barDirection: 0,
    hasLegend: false,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        chart.title = reader.string();
        break;
      case 2:
        chart.categories.push(reader.string());
        break;
      case 3:
        chart.series.push(readMessage(reader, decodeChartSeries));
        break;
      case 5:
        chart.type = reader.int32();
        break;
      case 6:
        chart.styleIndex = reader.int32();
        break;
      case 7:
        chart.id = reader.string();
        break;
      case 10:
        chart.barDirection = reader.int32();
        break;
      case 11:
        chart.hasLegend = reader.bool();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return chart;
}

function decodeDataValidation(reader, end) {
  const validation = {
    sqref: "",
    type: undefined,
    errorStyle: undefined,
    imeMode: undefined,
    operator: undefined,
    allowBlank: undefined,
    showDropDown: undefined,
    showInputMessage: undefined,
    showErrorMessage: undefined,
    errorTitle: undefined,
    errorMessage: undefined,
    promptTitle: undefined,
    promptMessage: undefined,
    formula1: undefined,
    formula2: undefined,
    uid: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        validation.sqref = reader.string();
        break;
      case 2:
        validation.type = reader.int32();
        break;
      case 3:
        validation.errorStyle = reader.int32();
        break;
      case 4:
        validation.imeMode = reader.int32();
        break;
      case 5:
        validation.operator = reader.int32();
        break;
      case 6:
        validation.allowBlank = reader.bool();
        break;
      case 7:
        validation.showDropDown = reader.bool();
        break;
      case 8:
        validation.showInputMessage = reader.bool();
        break;
      case 9:
        validation.showErrorMessage = reader.bool();
        break;
      case 10:
        validation.errorTitle = reader.string();
        break;
      case 11:
        validation.errorMessage = reader.string();
        break;
      case 12:
        validation.promptTitle = reader.string();
        break;
      case 13:
        validation.promptMessage = reader.string();
        break;
      case 14:
        validation.formula1 = reader.string();
        break;
      case 15:
        validation.formula2 = reader.string();
        break;
      case 16:
        validation.uid = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return validation;
}

function decodeDataValidations(reader, end) {
  const dataValidations = { items: [] };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        dataValidations.items.push(readMessage(reader, decodeDataValidation));
        break;
      default:
        reader.skip(wireType);
    }
  }

  return dataValidations;
}

function decodeTableColumn(reader, end) {
  const column = {
    id: 0,
    name: "",
    totalsRowLabel: undefined,
    totalsRowFunction: undefined,
    dataDxfId: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        column.id = reader.int32();
        break;
      case 2:
        column.name = reader.string();
        break;
      case 3:
        column.totalsRowLabel = reader.string();
        break;
      case 4:
        column.totalsRowFunction = reader.string();
        break;
      case 5:
        column.dataDxfId = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return column;
}

function decodeTableStyle(reader, end) {
  const style = {
    name: "",
    showFirstColumn: undefined,
    showLastColumn: undefined,
    showRowStripes: undefined,
    showColumnStripes: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        style.name = reader.string();
        break;
      case 2:
        style.showFirstColumn = reader.bool();
        break;
      case 3:
        style.showLastColumn = reader.bool();
        break;
      case 4:
        style.showRowStripes = reader.bool();
        break;
      case 5:
        style.showColumnStripes = reader.bool();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return style;
}

function decodeFilterValues(reader, end) {
  const filters = {
    values: [],
    blank: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        filters.values.push(reader.string());
        break;
      case 2:
        filters.blank = reader.bool();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return filters;
}

function decodeFilterColumn(reader, end) {
  const column = {
    colId: 0,
    type: "",
    filters: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        column.colId = reader.int32();
        break;
      case 2:
        column.type = reader.string();
        break;
      case 3:
        column.filters = readMessage(reader, decodeFilterValues);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return column;
}

function decodeAutoFilter(reader, end) {
  const autoFilter = {
    ref: "",
    columns: [],
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        autoFilter.ref = reader.string();
        break;
      case 2:
        autoFilter.columns.push(readMessage(reader, decodeFilterColumn));
        break;
      default:
        reader.skip(wireType);
    }
  }

  return autoFilter;
}

function decodeTable(reader, end) {
  const table = {
    id: 0,
    name: "",
    displayName: "",
    ref: "",
    columns: [],
    style: undefined,
    totalsRowShown: undefined,
    headerRowCount: undefined,
    totalsRowCount: undefined,
    autoFilter: undefined,
    dataDxfId: undefined,
    headerRowCellStyle: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        table.id = reader.int32();
        break;
      case 2:
        table.name = reader.string();
        break;
      case 3:
        table.displayName = reader.string();
        break;
      case 4:
        table.ref = reader.string();
        break;
      case 5:
        table.columns.push(readMessage(reader, decodeTableColumn));
        break;
      case 6:
        table.style = readMessage(reader, decodeTableStyle);
        break;
      case 7:
        table.totalsRowShown = reader.bool();
        break;
      case 8:
        table.headerRowCount = reader.int32();
        break;
      case 9:
        table.totalsRowCount = reader.int32();
        break;
      case 10:
        table.autoFilter = readMessage(reader, decodeAutoFilter);
        break;
      case 11:
        table.dataDxfId = reader.int32();
        break;
      case 12:
        table.headerRowCellStyle = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return table;
}

function decodeConditionalFormattingRule(reader, end) {
  const rule = {
    type: "",
    priority: undefined,
    dxfId: undefined,
    operator: undefined,
    formula: [],
    colorScale: undefined,
    dataBar: undefined,
    iconSet: undefined,
    stopIfTrue: undefined,
    aboveAverage: undefined,
    percent: undefined,
    bottom: undefined,
    text: undefined,
    timePeriod: undefined,
    rank: undefined,
    stdDev: undefined,
    equalAverage: undefined,
    id: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        rule.type = reader.string();
        break;
      case 2:
        rule.priority = reader.int32();
        break;
      case 3:
        rule.dxfId = reader.int32();
        break;
      case 4:
        rule.operator = reader.string();
        break;
      case 5:
        rule.formula.push(reader.string());
        break;
      case 6:
        rule.stopIfTrue = reader.bool();
        break;
      case 7:
        rule.aboveAverage = reader.bool();
        break;
      case 8:
        rule.percent = reader.bool();
        break;
      case 9:
        rule.bottom = reader.bool();
        break;
      case 10:
        rule.colorScale = readMessage(reader, decodeColorScale);
        break;
      case 11:
        rule.dataBar = readMessage(reader, decodeDataBar);
        break;
      case 12:
        rule.iconSet = readMessage(reader, decodeIconSet);
        break;
      case 13:
        rule.text = reader.string();
        break;
      case 14:
        rule.timePeriod = reader.string();
        break;
      case 15:
        rule.rank = reader.int32();
        break;
      case 16:
        rule.stdDev = reader.int32();
        break;
      case 17:
        rule.equalAverage = reader.bool();
        break;
      case 18:
        rule.id = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }

  return rule;
}

function decodeCfvo(reader, end) {
  const cfvo = {
    type: "",
    val: undefined,
    gte: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        cfvo.type = reader.string();
        break;
      case 2:
        cfvo.val = reader.string();
        break;
      case 3:
        cfvo.gte = reader.bool();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return cfvo;
}

function decodeColorScale(reader, end) {
  const colorScale = {
    cfvos: [],
    colors: [],
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        colorScale.cfvos.push(readMessage(reader, decodeCfvo));
        break;
      case 2:
        colorScale.colors.push(readMessage(reader, decodeColor));
        break;
      default:
        reader.skip(wireType);
    }
  }
  return colorScale;
}

function decodeDataBar(reader, end) {
  const dataBar = {
    cfvos: [],
    color: undefined,
    gradient: undefined,
    minLength: undefined,
    maxLength: undefined,
    showValue: undefined,
    border: undefined,
    direction: undefined,
    axisPosition: undefined,
    borderColor: undefined,
    negativeFillColor: undefined,
    negativeBorderColor: undefined,
    axisColor: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        dataBar.cfvos.push(readMessage(reader, decodeCfvo));
        break;
      case 2:
        dataBar.color = readMessage(reader, decodeColor);
        break;
      case 3:
        dataBar.gradient = reader.bool();
        break;
      case 4:
        dataBar.minLength = reader.uint32();
        break;
      case 5:
        dataBar.maxLength = reader.uint32();
        break;
      case 6:
        dataBar.showValue = reader.bool();
        break;
      case 7:
        dataBar.border = reader.bool();
        break;
      case 10:
        dataBar.direction = reader.string();
        break;
      case 11:
        dataBar.axisPosition = reader.string();
        break;
      case 12:
        dataBar.borderColor = readMessage(reader, decodeColor);
        break;
      case 13:
        dataBar.negativeFillColor = readMessage(reader, decodeColor);
        break;
      case 14:
        dataBar.negativeBorderColor = readMessage(reader, decodeColor);
        break;
      case 15:
        dataBar.axisColor = readMessage(reader, decodeColor);
        break;
      default:
        reader.skip(wireType);
    }
  }
  return dataBar;
}

function decodeIconSet(reader, end) {
  const iconSet = {
    iconSet: "",
    showValue: undefined,
    reverse: undefined,
    custom: undefined,
    cfvos: [],
    percent: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        iconSet.iconSet = reader.string();
        break;
      case 2:
        iconSet.showValue = reader.bool();
        break;
      case 3:
        iconSet.reverse = reader.bool();
        break;
      case 4:
        iconSet.custom = reader.bool();
        break;
      case 5:
        iconSet.cfvos.push(readMessage(reader, decodeCfvo));
        break;
      case 6:
        iconSet.percent = reader.bool();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return iconSet;
}

function decodeConditionalFormatting(reader, end) {
  const conditionalFormatting = {
    ranges: [],
    rules: [],
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        conditionalFormatting.ranges.push(readMessage(reader, decodeRange));
        break;
      case 2:
        conditionalFormatting.rules.push(readMessage(reader, decodeConditionalFormattingRule));
        break;
      default:
        reader.skip(wireType);
    }
  }

  return conditionalFormatting;
}

function decodeSparkline(reader, end) {
  const sparkline = {
    formula: undefined,
    reference: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        sparkline.formula = reader.string();
        break;
      case 2:
        sparkline.reference = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return sparkline;
}

function decodeSparklineGroup(reader, end) {
  const group = {
    uid: undefined,
    manualMax: undefined,
    manualMin: undefined,
    lineWeight: undefined,
    type: undefined,
    markers: undefined,
    high: undefined,
    low: undefined,
    first: undefined,
    last: undefined,
    negative: undefined,
    displayXAxis: undefined,
    seriesColor: undefined,
    negativeColor: undefined,
    axisColor: undefined,
    markersColor: undefined,
    firstMarkerColor: undefined,
    lastMarkerColor: undefined,
    highMarkerColor: undefined,
    lowMarkerColor: undefined,
    formula: undefined,
    sparklines: [],
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        group.uid = reader.string();
        break;
      case 2:
        group.manualMax = reader.double();
        break;
      case 3:
        group.manualMin = reader.double();
        break;
      case 4:
        group.lineWeight = reader.double();
        break;
      case 5:
        group.type = reader.int32();
        break;
      case 8:
        group.markers = reader.bool();
        break;
      case 9:
        group.high = reader.bool();
        break;
      case 10:
        group.low = reader.bool();
        break;
      case 11:
        group.first = reader.bool();
        break;
      case 12:
        group.last = reader.bool();
        break;
      case 13:
        group.negative = reader.bool();
        break;
      case 14:
        group.displayXAxis = reader.bool();
        break;
      case 19:
        group.seriesColor = readMessage(reader, decodeColor);
        break;
      case 20:
        group.negativeColor = readMessage(reader, decodeColor);
        break;
      case 21:
        group.axisColor = readMessage(reader, decodeColor);
        break;
      case 22:
        group.markersColor = readMessage(reader, decodeColor);
        break;
      case 23:
        group.firstMarkerColor = readMessage(reader, decodeColor);
        break;
      case 24:
        group.lastMarkerColor = readMessage(reader, decodeColor);
        break;
      case 25:
        group.highMarkerColor = readMessage(reader, decodeColor);
        break;
      case 26:
        group.lowMarkerColor = readMessage(reader, decodeColor);
        break;
      case 27:
        group.formula = reader.string();
        break;
      case 28:
        group.sparklines.push(readMessage(reader, decodeSparkline));
        break;
      default:
        reader.skip(wireType);
    }
  }
  return group;
}

function decodeSparklineGroups(reader, end) {
  const sparklineGroups = { groups: [] };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        sparklineGroups.groups.push(readMessage(reader, decodeSparklineGroup));
        break;
      default:
        reader.skip(wireType);
    }
  }
  return sparklineGroups;
}

function decodePivotTableLocation(reader, end) {
  const location = {
    reference: "",
    firstHeaderRow: undefined,
    firstDataRow: undefined,
    firstHeaderColumn: undefined,
    firstDataColumn: undefined,
    rowPageCount: undefined,
    columnPageCount: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        location.reference = reader.string();
        break;
      case 2:
        location.firstHeaderRow = reader.int32();
        break;
      case 3:
        location.firstDataRow = reader.int32();
        break;
      case 4:
        location.firstHeaderColumn = reader.int32();
        break;
      case 5:
        location.firstDataColumn = reader.int32();
        break;
      case 6:
        location.rowPageCount = reader.int32();
        break;
      case 7:
        location.columnPageCount = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return location;
}

function decodePivotFieldItem(reader, end) {
  const item = {
    type: undefined,
    index: undefined,
    hidden: undefined,
    calculated: undefined,
    missing: undefined,
    repeatedItemCount: undefined,
    dataFieldIndex: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        item.type = reader.string();
        break;
      case 2:
        item.index = reader.int32();
        break;
      case 3:
        item.hidden = reader.bool();
        break;
      case 4:
        item.calculated = reader.bool();
        break;
      case 5:
        item.missing = reader.bool();
        break;
      case 6:
        item.repeatedItemCount = reader.int32();
        break;
      case 7:
        item.dataFieldIndex = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return item;
}

function readRepeatedInt32(reader, wireType) {
  if (wireType === 0) return [reader.int32()];
  if (wireType !== 2) {
    reader.skip(wireType);
    return [];
  }
  const length = reader.uint32();
  const end = reader.pos + length;
  const values = [];
  while (!reader.eof(end)) values.push(reader.int32());
  reader.pos = end;
  return values;
}

function decodePivotField(reader, end) {
  const fieldValue = {
    index: undefined,
    name: "",
    axis: undefined,
    dataField: undefined,
    showAll: undefined,
    subtotalTop: undefined,
    items: [],
    numberFormatId: undefined,
    sortType: undefined,
    multipleItemSelectionAllowed: undefined,
    axisEnum: undefined,
    sortTypeEnum: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        fieldValue.index = reader.int32();
        break;
      case 2:
        fieldValue.name = reader.string();
        break;
      case 3:
        fieldValue.axis = reader.string();
        break;
      case 4:
        fieldValue.dataField = reader.bool();
        break;
      case 5:
        fieldValue.showAll = reader.bool();
        break;
      case 6:
        fieldValue.subtotalTop = reader.bool();
        break;
      case 7:
        fieldValue.items.push(readMessage(reader, decodePivotFieldItem));
        break;
      case 8:
        fieldValue.numberFormatId = reader.uint32();
        break;
      case 9:
        fieldValue.sortType = reader.string();
        break;
      case 10:
        fieldValue.multipleItemSelectionAllowed = reader.bool();
        break;
      case 30:
        fieldValue.axisEnum = reader.int32();
        break;
      case 31:
        fieldValue.sortTypeEnum = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return fieldValue;
}

function decodePivotPageField(reader, end) {
  const fieldValue = {
    field: undefined,
    item: undefined,
    name: undefined,
    hierarchy: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        fieldValue.field = reader.int32();
        break;
      case 2:
        fieldValue.item = reader.int32();
        break;
      case 3:
        fieldValue.name = reader.string();
        break;
      case 4:
        fieldValue.hierarchy = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return fieldValue;
}

function decodePivotDataField(reader, end) {
  const fieldValue = {
    field: undefined,
    name: undefined,
    subtotal: undefined,
    numberFormatId: undefined,
    showAs: undefined,
    baseField: undefined,
    baseItem: undefined,
    subtotalEnum: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        fieldValue.field = reader.int32();
        break;
      case 2:
        fieldValue.name = reader.string();
        break;
      case 3:
        fieldValue.subtotal = reader.string();
        break;
      case 4:
        fieldValue.numberFormatId = reader.uint32();
        break;
      case 5:
        fieldValue.showAs = reader.string();
        break;
      case 6:
        fieldValue.baseField = reader.int32();
        break;
      case 7:
        fieldValue.baseItem = reader.int32();
        break;
      case 30:
        fieldValue.subtotalEnum = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return fieldValue;
}

function decodePivotFilter(reader, end) {
  const filter = {
    field: undefined,
    type: "",
    name: undefined,
    description: undefined,
    typeEnum: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        filter.field = reader.int32();
        break;
      case 2:
        filter.type = reader.string();
        break;
      case 3:
        filter.name = reader.string();
        break;
      case 4:
        filter.description = reader.string();
        break;
      case 30:
        filter.typeEnum = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return filter;
}

function decodePivotTable(reader, end) {
  const pivotTable = {
    name: "",
    cacheId: undefined,
    location: undefined,
    dataOnRows: undefined,
    rowGrandTotals: undefined,
    columnGrandTotals: undefined,
    pivotFields: [],
    rowFields: [],
    columnFields: [],
    pageFields: [],
    dataFields: [],
    filters: [],
    compact: undefined,
    outline: undefined,
    showDrill: undefined,
    styleName: undefined,
    rowItems: [],
    columnItems: [],
    showRowHeaders: undefined,
    showColHeaders: undefined,
    dataCaption: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        pivotTable.name = reader.string();
        break;
      case 2:
        pivotTable.cacheId = reader.int32();
        break;
      case 3:
        pivotTable.location = readMessage(reader, decodePivotTableLocation);
        break;
      case 4:
        pivotTable.dataOnRows = reader.bool();
        break;
      case 5:
        pivotTable.rowGrandTotals = reader.bool();
        break;
      case 6:
        pivotTable.columnGrandTotals = reader.bool();
        break;
      case 7:
        pivotTable.pivotFields.push(readMessage(reader, decodePivotField));
        break;
      case 8:
        pivotTable.rowFields.push(...readRepeatedInt32(reader, wireType));
        break;
      case 9:
        pivotTable.columnFields.push(...readRepeatedInt32(reader, wireType));
        break;
      case 10:
        pivotTable.pageFields.push(readMessage(reader, decodePivotPageField));
        break;
      case 11:
        pivotTable.dataFields.push(readMessage(reader, decodePivotDataField));
        break;
      case 12:
        pivotTable.filters.push(readMessage(reader, decodePivotFilter));
        break;
      case 13:
        pivotTable.compact = reader.bool();
        break;
      case 14:
        pivotTable.outline = reader.bool();
        break;
      case 15:
        pivotTable.showDrill = reader.bool();
        break;
      case 16:
        pivotTable.styleName = reader.string();
        break;
      case 17:
        pivotTable.rowItems.push(readMessage(reader, decodePivotFieldItem));
        break;
      case 18:
        pivotTable.columnItems.push(readMessage(reader, decodePivotFieldItem));
        break;
      case 19:
        pivotTable.showRowHeaders = reader.bool();
        break;
      case 20:
        pivotTable.showColHeaders = reader.bool();
        break;
      case 30:
        pivotTable.dataCaption = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return pivotTable;
}

function decodeSlicer(reader, end) {
  const slicer = {
    name: "",
    caption: "",
    cache: "",
    lockedPosition: undefined,
    displayHeader: undefined,
    showNoDataItems: undefined,
    sortBy: undefined,
    style: undefined,
    fromAnchor: undefined,
    toAnchor: undefined,
    cacheId: undefined,
    width: undefined,
    height: undefined,
    isMultiSelect: undefined,
    sortByEnum: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        slicer.name = reader.string();
        break;
      case 2:
        slicer.caption = reader.string();
        break;
      case 3:
        slicer.cache = reader.string();
        break;
      case 4:
        slicer.lockedPosition = reader.bool();
        break;
      case 5:
        slicer.displayHeader = reader.bool();
        break;
      case 6:
        slicer.showNoDataItems = reader.bool();
        break;
      case 7:
        slicer.sortBy = reader.string();
        break;
      case 8:
        slicer.style = reader.string();
        break;
      case 9:
        slicer.fromAnchor = readMessage(reader, decodeAnchorMarker);
        break;
      case 10:
        slicer.toAnchor = readMessage(reader, decodeAnchorMarker);
        break;
      case 11:
        slicer.cacheId = reader.int32();
        break;
      case 12:
        slicer.width = reader.double();
        break;
      case 13:
        slicer.height = reader.double();
        break;
      case 14:
        slicer.isMultiSelect = reader.bool();
        break;
      case 18:
        slicer.sortByEnum = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return slicer;
}

function decodeTimeline(reader, end) {
  const timeline = {
    name: "",
    caption: "",
    cache: "",
    fromAnchor: undefined,
    toAnchor: undefined,
    cacheId: undefined,
    width: undefined,
    height: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        timeline.name = reader.string();
        break;
      case 2:
        timeline.caption = reader.string();
        break;
      case 3:
        timeline.cache = reader.string();
        break;
      case 4:
        timeline.fromAnchor = readMessage(reader, decodeAnchorMarker);
        break;
      case 5:
        timeline.toAnchor = readMessage(reader, decodeAnchorMarker);
        break;
      case 6:
        timeline.cacheId = reader.int32();
        break;
      case 7:
        timeline.width = reader.double();
        break;
      case 8:
        timeline.height = reader.double();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return timeline;
}

function decodeSlicerCacheItem(reader, end) {
  const item = {
    index: undefined,
    value: "",
    selected: undefined,
    hasData: undefined,
    hidden: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        item.index = reader.int32();
        break;
      case 2:
        item.value = reader.string();
        break;
      case 3:
        item.selected = reader.bool();
        break;
      case 4:
        item.hasData = reader.bool();
        break;
      case 5:
        item.hidden = reader.bool();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return item;
}

function decodeSlicerCache(reader, end) {
  const cache = {
    name: "",
    caption: undefined,
    sourceName: undefined,
    type: undefined,
    pivotCacheId: undefined,
    pivotTableIds: [],
    tableId: undefined,
    tableName: undefined,
    columnName: undefined,
    crossFilter: undefined,
    sortOrder: undefined,
    items: [],
    typeEnum: undefined,
    crossFilterEnum: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        cache.name = reader.string();
        break;
      case 2:
        cache.caption = reader.string();
        break;
      case 3:
        cache.sourceName = reader.string();
        break;
      case 4:
        cache.type = reader.string();
        break;
      case 5:
        cache.pivotCacheId = reader.int32();
        break;
      case 6:
        cache.pivotTableIds.push(...readRepeatedInt32(reader, wireType));
        break;
      case 7:
        cache.tableId = reader.int32();
        break;
      case 8:
        cache.tableName = reader.string();
        break;
      case 9:
        cache.columnName = reader.string();
        break;
      case 10:
        cache.crossFilter = reader.string();
        break;
      case 11:
        cache.sortOrder = reader.string();
        break;
      case 12:
        cache.items.push(readMessage(reader, decodeSlicerCacheItem));
        break;
      case 13:
        cache.typeEnum = reader.int32();
        break;
      case 14:
        cache.crossFilterEnum = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return cache;
}

function decodeTimelineCacheItem(reader, end) {
  const item = {
    index: undefined,
    value: "",
    selected: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        item.index = reader.int32();
        break;
      case 2:
        item.value = reader.string();
        break;
      case 3:
        item.selected = reader.bool();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return item;
}

function decodeTimelineCache(reader, end) {
  const cache = {
    name: "",
    caption: undefined,
    pivotCacheId: undefined,
    pivotTableIds: [],
    columnName: undefined,
    items: [],
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        cache.name = reader.string();
        break;
      case 2:
        cache.caption = reader.string();
        break;
      case 3:
        cache.pivotCacheId = reader.int32();
        break;
      case 4:
        cache.pivotTableIds.push(...readRepeatedInt32(reader, wireType));
        break;
      case 5:
        cache.columnName = reader.string();
        break;
      case 6:
        cache.items.push(readMessage(reader, decodeTimelineCacheItem));
        break;
      default:
        reader.skip(wireType);
    }
  }
  return cache;
}

function decodeSharedItems(reader, end) {
  const sharedItems = {
    values: [],
    containsBlank: undefined,
    containsDate: undefined,
    containsNumeric: undefined,
    containsString: undefined,
    minValue: undefined,
    maxValue: undefined,
    minDate: undefined,
    maxDate: undefined,
    count: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        sharedItems.values.push(reader.string());
        break;
      case 2:
        sharedItems.containsBlank = reader.bool();
        break;
      case 3:
        sharedItems.containsDate = reader.bool();
        break;
      case 4:
        sharedItems.containsNumeric = reader.bool();
        break;
      case 5:
        sharedItems.containsString = reader.bool();
        break;
      case 9:
        sharedItems.minValue = reader.double();
        break;
      case 10:
        sharedItems.maxValue = reader.double();
        break;
      case 11:
        sharedItems.minDate = reader.string();
        break;
      case 12:
        sharedItems.maxDate = reader.string();
        break;
      case 13:
        sharedItems.count = reader.uint32();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return sharedItems;
}

function decodeCacheField(reader, end) {
  const cacheField = {
    name: "",
    numFmtId: undefined,
    sharedItems: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        cacheField.name = reader.string();
        break;
      case 2:
        cacheField.numFmtId = reader.uint32();
        break;
      case 3:
        cacheField.sharedItems = readMessage(reader, decodeSharedItems);
        break;
      default:
        reader.skip(wireType);
    }
  }
  return cacheField;
}

function decodePivotCache(reader, end) {
  const cache = {
    id: undefined,
    name: undefined,
    fields: [],
    worksheetSourceReference: undefined,
    worksheetSourceSheet: undefined,
    refreshedBy: undefined,
    refreshedDate: undefined,
    recordCount: undefined,
  };
  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        cache.id = reader.int32();
        break;
      case 2:
        cache.name = reader.string();
        break;
      case 3:
        cache.fields.push(readMessage(reader, decodeCacheField));
        break;
      case 6:
        cache.worksheetSourceReference = reader.string();
        break;
      case 7:
        cache.worksheetSourceSheet = reader.string();
        break;
      case 8:
        cache.refreshedBy = reader.string();
        break;
      case 9:
        cache.refreshedDate = reader.string();
        break;
      case 13:
        cache.recordCount = reader.uint32();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return cache;
}

function decodeSheet(reader, end) {
  const sheet = {
    id: undefined,
    sheetId: undefined,
    index: 0,
    name: "",
    rows: [],
    columns: [],
    defaultRowHeight: 0,
    drawings: [],
    defaultColWidth: 0,
    baseColWidth: undefined,
    showGridLines: undefined,
    mergedCells: [],
    conditionalFormattings: [],
    tables: [],
    pivotTables: [],
    slicers: [],
    timelines: [],
    sparklineGroups: undefined,
    dataValidations: undefined,
  };

  while (!reader.eof(end)) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        sheet.index = reader.int32();
        break;
      case 2:
        sheet.name = reader.string();
        break;
      case 3:
        sheet.rows.push(readMessage(reader, decodeRow));
        break;
      case 6:
        sheet.columns.push(readMessage(reader, decodeColumn));
        break;
      case 7:
        sheet.defaultRowHeight = reader.float();
        break;
      case 8:
        sheet.drawings.push(readMessage(reader, decodeDrawing));
        break;
      case 9:
        sheet.defaultColWidth = reader.float();
        break;
      case 10:
        sheet.showGridLines = reader.bool();
        break;
      case 11:
        sheet.id = reader.string();
        break;
      case 12:
        sheet.mergedCells.push(readMessage(reader, decodeRange));
        break;
      case 13:
        sheet.conditionalFormattings.push(readMessage(reader, decodeConditionalFormatting));
        break;
      case 15:
        sheet.tables.push(readMessage(reader, decodeTable));
        break;
      case 16:
        sheet.pivotTables.push(readMessage(reader, decodePivotTable));
        break;
      case 17:
        sheet.slicers.push(readMessage(reader, decodeSlicer));
        break;
      case 19:
        sheet.timelines.push(readMessage(reader, decodeTimeline));
        break;
      case 20:
        sheet.sheetId = reader.string();
        break;
      case 21:
        sheet.baseColWidth = reader.float();
        break;
      case 27:
        sheet.sparklineGroups = readMessage(reader, decodeSparklineGroups);
        break;
      case 28:
        sheet.dataValidations = readMessage(reader, decodeDataValidations);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return sheet;
}

export function decodeWorkbookLite(bytes) {
  const reader = new ProtobufReader(bytes);
  const workbook = {
    id: undefined,
    sheets: [],
    styles: undefined,
    images: [],
    contentReferences: [],
    people: [],
    threads: [],
    notes: [],
    slicerCaches: [],
    pivotCaches: [],
    timelineCaches: [],
  };

  while (!reader.eof()) {
    const tag = reader.uint32();
    if (tag === 0) break;
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        workbook.sheets.push(readMessage(reader, decodeSheet));
        break;
      case 2:
        workbook.styles = readMessage(reader, decodeStyles);
        break;
      case 4:
        workbook.contentReferences.push(reader.bytesValue());
        break;
      case 5:
        workbook.images.push(readMessage(reader, decodeImage));
        break;
      case 10:
        workbook.id = reader.string();
        break;
      case 20:
        workbook.people.push(readMessage(reader, decodePerson));
        break;
      case 21:
        workbook.threads.push(readMessage(reader, decodeThread));
        break;
      case 22:
        workbook.notes.push(readMessage(reader, decodeNote));
        break;
      case 23:
        workbook.slicerCaches.push(readMessage(reader, decodeSlicerCache));
        break;
      case 24:
        workbook.pivotCaches.push(readMessage(reader, decodePivotCache));
        break;
      case 25:
        workbook.timelineCaches.push(readMessage(reader, decodeTimelineCache));
        break;
      default:
        reader.skip(wireType);
    }
  }

  return workbook;
}
