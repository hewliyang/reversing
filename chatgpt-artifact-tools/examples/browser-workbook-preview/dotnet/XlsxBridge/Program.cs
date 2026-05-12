using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;

if (args.Length == 0)
{
    Console.Error.WriteLine("Usage: XlsxBridge <workbook.xlsx>");
    return 2;
}

var stopwatch = Stopwatch.StartNew();
var workbookPath = args[0];
var model = NativeXlsxBridge.Parse(workbookPath);
model.Timings.Add(new Timing("total", stopwatch.ElapsedMilliseconds));

var options = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
};
JsonSerializer.Serialize(Console.OpenStandardOutput(), model, options);
return 0;

internal static class NativeXlsxBridge
{
    public static WorkbookModel Parse(string path)
    {
        var timings = new List<Timing>();
        var sw = Stopwatch.StartNew();
        using var document = SpreadsheetDocument.Open(path, false);
        var workbookPart = document.WorkbookPart ?? throw new InvalidOperationException("Workbook part missing.");
        timings.Add(new Timing("open", sw.ElapsedMilliseconds));

        sw.Restart();
        var sharedStrings = ReadSharedStrings(workbookPart);
        timings.Add(new Timing("sharedStrings", sw.ElapsedMilliseconds));

        sw.Restart();
        var styles = ReadStyles(workbookPart.WorkbookStylesPart);
        timings.Add(new Timing("styles", sw.ElapsedMilliseconds));

        var sheets = new List<SheetModel>();
        foreach (var sheet in workbookPart.Workbook.Sheets?.Elements<Sheet>() ?? [])
        {
            var sheetSw = Stopwatch.StartNew();
            if (sheet.Id?.Value == null) continue;
            var worksheetPart = (WorksheetPart)workbookPart.GetPartById(sheet.Id.Value);
            sheets.Add(ReadSheet(sheet, worksheetPart, sharedStrings));
            timings.Add(new Timing($"sheet:{sheet.Name}", sheetSw.ElapsedMilliseconds));
        }

        return new WorkbookModel("spreadsheet", new WorkbookPayload(sheets, styles), timings);
    }

    private static List<string> ReadSharedStrings(WorkbookPart workbookPart)
    {
        var table = workbookPart.SharedStringTablePart?.SharedStringTable;
        if (table == null) return [];
        return table.Elements<SharedStringItem>().Select(item => item.InnerText ?? "").ToList();
    }

    private static StylesModel ReadStyles(WorkbookStylesPart? stylesPart)
    {
        var stylesheet = stylesPart?.Stylesheet;
        if (stylesheet == null) return StylesModel.Empty;
        return new StylesModel(
            stylesheet.Fonts?.Elements<Font>().Select(ReadFont).ToList() ?? [],
            stylesheet.Fills?.Elements<Fill>().Select(ReadFill).ToList() ?? [],
            stylesheet.Borders?.Elements<Border>().Select(ReadBorder).ToList() ?? [],
            stylesheet.CellFormats?.Elements<CellFormat>().Select(ReadCellFormat).ToList() ?? [],
            stylesheet.NumberingFormats?.Elements<NumberingFormat>().Select(ReadNumberFormat).ToList() ?? []
        );
    }

    private static FontModel ReadFont(Font font)
    {
        return new FontModel(
            font.Bold != null ? true : null,
            font.Italic != null ? true : null,
            font.Underline != null ? "single" : null,
            DoubleValue(font.FontSize?.Val),
            ReadColor(font.Color),
            font.FontName?.Val?.Value,
            font.FontName?.Val?.Value
        );
    }

    private static FillModel ReadFill(Fill fill)
    {
        var pattern = fill.PatternFill;
        var color = ReadColor(pattern?.ForegroundColor) ?? ReadColor(pattern?.BackgroundColor);
        var patternType = pattern?.PatternType?.Value.ToString();
        return new FillModel(color, patternType);
    }

    private static BorderModel ReadBorder(Border border)
    {
        return new BorderModel(
            ReadBorderSide(border.LeftBorder),
            ReadBorderSide(border.RightBorder),
            ReadBorderSide(border.TopBorder),
            ReadBorderSide(border.BottomBorder)
        );
    }

    private static BorderSideModel? ReadBorderSide(BorderPropertiesType? side)
    {
        if (side?.Style?.Value == null) return null;
        return new BorderSideModel(side.Style.Value.ToString(), ReadColor(side.Color));
    }

    private static CellFormatModel ReadCellFormat(CellFormat format)
    {
        return new CellFormatModel(
            UIntValue(format.FontId),
            UIntValue(format.FillId),
            UIntValue(format.BorderId),
            UIntValue(format.NumberFormatId),
            ReadAlignment(format.Alignment)
        );
    }

    private static AlignmentModel? ReadAlignment(Alignment? alignment)
    {
        if (alignment == null) return null;
        return new AlignmentModel(
            alignment.Horizontal?.Value.ToString(),
            alignment.Vertical?.Value.ToString(),
            alignment.WrapText?.Value
        );
    }

    private static NumberFormatModel ReadNumberFormat(NumberingFormat format)
    {
        return new NumberFormatModel(UIntValue(format.NumberFormatId), format.FormatCode?.Value);
    }

    private static SheetModel ReadSheet(Sheet sheet, WorksheetPart worksheetPart, List<string> sharedStrings)
    {
        var worksheet = worksheetPart.Worksheet;
        var sheetData = worksheet.GetFirstChild<SheetData>();
        var rows = new List<RowModel>();
        if (sheetData != null)
        {
            foreach (var row in sheetData.Elements<Row>())
            {
                var cells = row.Elements<Cell>().Select(cell => ReadCell(cell, sharedStrings)).Where(cell => cell != null).Cast<CellModel>().ToList();
                if (cells.Count == 0 && row.Hidden?.Value != true && row.Height?.Value == null && row.StyleIndex?.Value == null) continue;
                rows.Add(new RowModel(
                    (int)(row.RowIndex?.Value ?? 0),
                    cells,
                    row.Height?.Value,
                    row.CustomHeight?.Value,
                    UIntValue(row.StyleIndex),
                    row.Hidden?.Value
                ));
            }
        }

        return new SheetModel(
            sheet.Name?.Value ?? "Sheet",
            ReadColumns(worksheet),
            rows,
            ReadMergedCells(worksheet),
            ReadDimension(worksheet),
            worksheet.SheetFormatProperties?.DefaultRowHeight?.Value,
            worksheet.SheetFormatProperties?.DefaultColumnWidth?.Value,
            ReadShowGridLines(worksheet)
        );
    }

    private static CellModel? ReadCell(Cell cell, List<string> sharedStrings)
    {
        var address = cell.CellReference?.Value;
        if (string.IsNullOrEmpty(address)) return null;
        var formula = cell.CellFormula?.Text;
        var rawValue = cell.CellValue?.Text;
        var value = ReadCellValue(cell, rawValue, sharedStrings);
        if (value == null && formula == null) return null;
        return new CellModel(address, value, formula, CellDataType(cell, value), UIntValue(cell.StyleIndex));
    }

    private static string? ReadCellValue(Cell cell, string? rawValue, List<string> sharedStrings)
    {
        if (cell.DataType?.Value == CellValues.SharedString && int.TryParse(rawValue, out var sharedStringIndex))
        {
            return sharedStringIndex >= 0 && sharedStringIndex < sharedStrings.Count ? sharedStrings[sharedStringIndex] : "";
        }
        if (cell.DataType?.Value == CellValues.InlineString) return cell.InlineString?.InnerText ?? "";
        if (cell.DataType?.Value == CellValues.Boolean) return rawValue == "1" ? "TRUE" : "FALSE";
        return rawValue;
    }

    private static int CellDataType(Cell cell, string? value)
    {
        if (cell.DataType?.Value == null && double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out _)) return 5;
        return 1;
    }

    private static List<ColumnModel> ReadColumns(Worksheet worksheet)
    {
        return worksheet.Elements<Columns>()
            .SelectMany(columns => columns.Elements<Column>())
            .Select(column => new ColumnModel(
                (int)(column.Min?.Value ?? 1),
                (int)(column.Max?.Value ?? column.Min?.Value ?? 1),
                column.Width?.Value,
                column.CustomWidth?.Value,
                UIntValue(column.Style),
                column.Hidden?.Value
            ))
            .ToList();
    }

    private static List<string> ReadMergedCells(Worksheet worksheet)
    {
        return worksheet.Elements<MergeCells>()
            .SelectMany(mergeCells => mergeCells.Elements<MergeCell>())
            .Select(cell => cell.Reference?.Value)
            .Where(reference => !string.IsNullOrEmpty(reference))
            .Cast<string>()
            .ToList();
    }

    private static string? ReadDimension(Worksheet worksheet)
    {
        return worksheet.GetFirstChild<SheetDimension>()?.Reference?.Value;
    }

    private static bool? ReadShowGridLines(Worksheet worksheet)
    {
        var value = worksheet.SheetViews?.Elements<SheetView>().FirstOrDefault()?.ShowGridLines?.Value;
        return value == false ? false : null;
    }

    private static ColorModel? ReadColor(ColorType? color)
    {
        if (color == null) return null;
        if (color.Rgb?.Value != null) return new ColorModel(1, color.Rgb.Value, null, null);
        if (color.Theme?.Value != null)
        {
            var tint = color.Tint?.Value == null ? null : (int?)Math.Round(color.Tint.Value * 100000);
            return new ColorModel(2, $"theme:{color.Theme.Value}", tint == null ? null : new ColorTransformModel(tint), null);
        }
        if (color.Indexed?.Value != null) return new ColorModel(3, color.Indexed.Value.ToString(CultureInfo.InvariantCulture), null, (int)color.Indexed.Value);
        return null;
    }

    private static int? UIntValue(UInt32Value? value)
    {
        return value?.Value == null ? null : (int)value.Value;
    }

    private static double? DoubleValue(DoubleValue? value)
    {
        return value?.Value;
    }
}

internal sealed record WorkbookModel(string Kind, WorkbookPayload Workbook, List<Timing> Timings);
internal sealed record WorkbookPayload(List<SheetModel> Sheets, StylesModel Styles);
internal sealed record Timing(string Name, long Ms);
internal sealed record SheetModel(
    string Name,
    List<ColumnModel> Columns,
    List<RowModel> Rows,
    List<string> MergedCells,
    string? Dimension,
    double? DefaultRowHeight,
    double? DefaultColumnWidth,
    bool? ShowGridLines
);
internal sealed record ColumnModel(int Min, int Max, double? Width, bool? CustomWidth, int? StyleIndex, bool? Hidden);
internal sealed record RowModel(int Index, List<CellModel> Cells, double? Height, bool? CustomHeight, int? StyleIndex, bool? Hidden);
internal sealed record CellModel(string Address, string? Value, string? Formula, int DataType, int? StyleIndex);
internal sealed record StylesModel(
    List<FontModel> Fonts,
    List<FillModel> Fills,
    List<BorderModel> Borders,
    List<CellFormatModel> CellXfs,
    List<NumberFormatModel> NumberFormats
)
{
    public static StylesModel Empty { get; } = new([], [], [], [], []);
}
internal sealed record FontModel(bool? Bold, bool? Italic, string? Underline, double? FontSize, ColorModel? Fill, string? Name, string? Typeface);
internal sealed record FillModel(ColorModel? Color, string? PatternType);
internal sealed record BorderModel(BorderSideModel? Left, BorderSideModel? Right, BorderSideModel? Top, BorderSideModel? Bottom);
internal sealed record BorderSideModel(string? Style, ColorModel? Color);
internal sealed record CellFormatModel(int? FontId, int? FillId, int? BorderId, int? NumFmtId, AlignmentModel? Alignment);
internal sealed record AlignmentModel(string? Horizontal, string? Vertical, bool? WrapText);
internal sealed record NumberFormatModel(int? Id, string? FormatCode);
internal sealed record ColorModel(int Type, string Value, ColorTransformModel? Transform, int? IndexedColorId);
internal sealed record ColorTransformModel(int? Tint);
