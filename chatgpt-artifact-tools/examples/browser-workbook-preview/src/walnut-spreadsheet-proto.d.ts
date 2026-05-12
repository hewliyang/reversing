export type Int32 = number;
export type Float = number;

export interface ProtoCodec<T> {
  encode(value: T, writer?: unknown): { finish?: () => Uint8Array };
  decode(input: Uint8Array | unknown, length?: number): T;
  create(value?: Partial<T>): T;
  fromPartial(value: Partial<T>): T;
}

export interface WorkbookProto {
  id?: string;
  sheets: SheetProto[];
  styles?: StylesProto;
  theme?: unknown;
  contentReferences: unknown[];
  images: ImageAssetProto[];
  people: PersonProto[];
  threads: ThreadProto[];
  notes: NoteProto[];
  slicerCaches: SlicerCacheProto[];
  pivotCaches: PivotCacheProto[];
  timelineCaches: TimelineCacheProto[];
  definedNames?: unknown;
  metadata?: unknown;
  featurePropertyBags?: unknown;
  textStyles: unknown[];
  codeEnvironments: unknown[];
  codeBlocks: unknown[];
}

export interface SheetProto {
  id?: string;
  sheetId?: string;
  index: Int32;
  name: string;
  rows: RowProto[];
  innerXml: string;
  outerXml: string;
  columns: ColumnProto[];
  defaultRowHeight: Float;
  drawings: DrawingProto[];
  defaultColWidth: Float;
  baseColWidth?: Float;
  showGridLines?: boolean;
  mergedCells: RangeProto[];
  conditionalFormattings: ConditionalFormattingProto[];
  sharedFormulas: SharedFormulaProto[];
  tables: TableProto[];
  pivotTables: PivotTableProto[];
  slicers: SlicerProto[];
  tabColor?: unknown;
  timelines: TimelineProto[];
  sparklineGroups?: SparklineGroupsProto;
  dataValidations?: DataValidationsProto;
}

export interface RowProto {
  index: Int32;
  cells: CellProto[];
  height: Float;
  customHeight: boolean;
  styleIndex?: Int32;
  hidden?: boolean;
}

export interface CellProto {
  address: string;
  value?: string;
  formula?: string;
  dataType: CellDataType;
  styleIndex?: Int32;
  paragraphs: unknown[];
  textStyle?: unknown;
  sharedFormulaSi?: Int32;
  formulaType?: CellFormulaType;
  formulaRef?: string;
  formulaAlwaysCalculateArray?: boolean;
  cellMetadataIndex?: Int32;
  dataTableRowInput?: string;
  dataTableColumnInput?: string;
  dataTableRowOriented?: boolean;
  dataTableTwoVariable?: boolean;
}

export interface ColumnProto {
  min: Int32;
  max: Int32;
  width: Float;
  customWidth: boolean;
  styleIndex?: Int32;
  hidden?: boolean;
}

export interface RangeProto {
  sheetName: string;
  sheetId?: string;
  startAddress: string;
  endAddress: string;
}

export interface StylesProto {
  fonts: FontProto[];
  fills: FillProto[];
  cellXfs: CellFormatProto[];
  borders: BorderProto[];
  cellStyles: unknown[];
  cellStyleXfs: CellFormatProto[];
  numberFormats: NumberFormatProto[];
  dxfs: DifferentialFormatProto[];
  indexedColors: unknown[];
  mruColors: unknown[];
}

export interface FontProto {
  bold?: boolean;
  italic?: boolean;
  fontSize?: Int32;
  fill?: unknown;
  underline?: string;
  name?: string;
  scheme?: string;
  typeface?: string;
}

export interface FillProto {
  type: Int32;
  color?: ColorProto;
}

export interface ColorProto {
  type: Int32;
  value: string;
  lastColor?: string;
}

export interface CellFormatProto {
  numFmtId?: Int32;
  fontId?: Int32;
  fillId?: Int32;
  borderId?: Int32;
  xfId?: Int32;
  applyFill?: boolean;
  applyFont?: boolean;
  applyBorder?: boolean;
  horizontalAlignment?: string;
  verticalAlignment?: string;
  applyNumberFormat?: boolean;
  wrapText?: boolean;
  shrinkToFit?: boolean;
}

export interface BorderProto {
  left?: BorderLineProto;
  right?: BorderLineProto;
  top?: BorderLineProto;
  bottom?: BorderLineProto;
}

export interface BorderLineProto {
  style: string;
  color?: ColorProto;
  indexedColorId?: Int32;
}

export interface NumberFormatProto {
  id: Int32;
  formatCode: string;
}

export interface DifferentialFormatProto {
  font?: FontProto;
  fill?: unknown;
  border?: BorderProto;
  numFmt?: NumberFormatProto;
}

export interface TableProto {
  id: Int32;
  name: string;
  displayName: string;
  ref: string;
  columns: TableColumnProto[];
  style?: TableStyleInfoProto;
  totalsRowShown?: boolean;
  headerRowCount?: Int32;
  totalsRowCount?: Int32;
  autoFilter?: AutoFilterProto;
  dataDxfId?: Int32;
  headerRowCellStyle?: string;
}

export interface TableColumnProto {
  id: Int32;
  name: string;
  totalsRowLabel?: string;
  totalsRowFunction?: string;
  dataDxfId?: Int32;
}

export interface TableStyleInfoProto {
  name: string;
  showFirstColumn?: boolean;
  showLastColumn?: boolean;
  showRowStripes?: boolean;
  showColumnStripes?: boolean;
}

export interface AutoFilterProto {
  ref: string;
  columns: FilterColumnProto[];
}

export interface FilterColumnProto {
  colId: Int32;
  type: string;
  filters?: FilterValuesProto;
}

export interface FilterValuesProto {
  values: string[];
  blank?: boolean;
}

export interface DataValidationsProto {
  items: DataValidationProto[];
}

export interface DataValidationProto {
  sqref: string;
  type?: DataValidationType;
  errorStyle?: DataValidationErrorStyle;
  imeMode?: DataValidationImeMode;
  operator?: DataValidationOperator;
  allowBlank?: boolean;
  showDropDown?: boolean;
  showInputMessage?: boolean;
  showErrorMessage?: boolean;
  errorTitle?: string;
  errorMessage?: string;
  promptTitle?: string;
  promptMessage?: string;
  formula1?: string;
  formula2?: string;
  uid?: string;
}

export interface ConditionalFormattingProto {
  ranges: RangeProto[];
  rules: CfRuleProto[];
}

export interface CfRuleProto {
  type: string;
  priority?: Int32;
  dxfId?: Int32;
  operator?: string;
  formula: string[];
  colorScale?: unknown;
  dataBar?: unknown;
  iconSet?: unknown;
  stopIfTrue?: boolean;
  aboveAverage?: boolean;
  percent?: boolean;
  bottom?: boolean;
  text?: string;
  timePeriod?: string;
  rank?: Int32;
  stdDev?: Int32;
  equalAverage?: boolean;
  id?: string;
}

export interface SharedFormulaProto {
  si: Int32;
  base: string;
  anchor: string;
}

export interface DrawingProto {
  fromAnchor?: AnchorMarkerProto;
  toAnchor?: AnchorMarkerProto;
  chart?: SharedChartProto;
  imageReference?: ImageReferenceProto;
  extentCx?: string;
  extentCy?: string;
  shape?: ShapeElementProto;
}

export interface AnchorMarkerProto {
  rowId: string;
  colId: string;
  colOffset: string;
  rowOffset: string;
}

export interface ImageAssetProto {
  contentType: string;
  data: Uint8Array;
  id: string;
  prompt?: string;
  uri?: string;
}

export interface ImageReferenceProto {
  id: string;
}

export interface ShapeElementProto {
  [key: string]: unknown;
}

export interface SharedChartProto {
  title: string;
  categories: string[];
  series: unknown[];
  type: Int32;
  styleIndex: Int32;
  id: string;
  xAxis?: unknown;
  yAxis?: unknown;
  barDirection: Int32;
  hasLegend: boolean;
  legend?: unknown;
  titleTextStyle?: unknown;
  pivotFormats: unknown[];
}

export interface PivotTableProto {
  name: string;
  cacheId: Int32;
  location?: PivotTableLocationProto;
  dataOnRows?: boolean;
  rowGrandTotals?: boolean;
  columnGrandTotals?: boolean;
  pivotFields: PivotFieldProto[];
  rowFields: Int32[];
  columnFields: Int32[];
  pageFields: PivotPageFieldProto[];
  dataFields: PivotDataFieldProto[];
  filters: PivotFilterProto[];
  compact?: boolean;
  outline?: boolean;
  showDrill?: boolean;
  styleName?: string;
  rowItems: PivotFieldItemProto[];
  columnItems: PivotFieldItemProto[];
  showRowHeaders?: boolean;
  showColHeaders?: boolean;
  showRowStripes?: boolean;
  showColStripes?: boolean;
  showLastColumn?: boolean;
  applyNumberFormats?: boolean;
  applyBorderFormats?: boolean;
  applyFontFormats?: boolean;
  applyPatternFormats?: boolean;
  applyAlignmentFormats?: boolean;
  applyWidthHeightFormats?: boolean;
  dataCaption?: string;
  updatedVersion?: Int32;
  minRefreshableVersion?: Int32;
  useAutoFormatting?: boolean;
  itemPrintTitles?: boolean;
  createdVersion?: Int32;
  indent?: number;
  outlineData?: boolean;
  multipleFieldFilters?: boolean;
  chartFormat?: Int32;
  extensionListXml?: string;
}

export interface PivotTableLocationProto {
  reference: string;
  firstHeaderRow?: Int32;
  firstDataRow?: Int32;
  firstHeaderColumn?: Int32;
  firstDataColumn?: Int32;
  rowPageCount?: Int32;
  columnPageCount?: Int32;
}

export interface PivotCacheProto {
  id: Int32;
  name?: string;
  fields: CacheFieldProto[];
  worksheetSourceReference?: string;
  worksheetSourceSheet?: string;
  refreshedBy?: string;
  refreshedDate?: string;
  createdVersion?: Int32;
  refreshedVersion?: Int32;
  minRefreshableVersion?: Int32;
  recordCount?: Int32;
  extensionListXml?: string;
}

export interface CacheFieldProto {
  name: string;
  numFmtId?: Int32;
  sharedItems?: SharedItemsProto;
  fieldGroup?: FieldGroupProto;
}

export interface SharedItemsProto {
  values: string[];
  containsBlank?: boolean;
  containsDate?: boolean;
  containsNumeric?: boolean;
  containsString?: boolean;
  containsSemiMixedTypes?: boolean;
  containsNonDate?: boolean;
  containsInteger?: boolean;
  minValue?: number;
  maxValue?: number;
  minDate?: string;
  maxDate?: string;
  count?: Int32;
  containsMixedTypes?: boolean;
}

export interface FieldGroupProto {
  parent?: Int32;
  base?: Int32;
  rangePr?: unknown;
  groupItems: string[];
}

export interface PivotFieldProto {
  index: Int32;
  name: string;
  axis?: string;
  dataField?: boolean;
  showAll?: boolean;
  subtotalTop?: boolean;
  items: PivotFieldItemProto[];
  numberFormatId?: Int32;
  sortType?: string;
  multipleItemSelectionAllowed?: boolean;
  axisEnum?: PivotAxis;
  sortTypeEnum?: FieldSort;
}

export interface PivotFieldItemProto {
  type?: string;
  index?: Int32;
  hidden?: boolean;
  calculated?: boolean;
  missing?: boolean;
  repeatedItemCount?: Int32;
  dataFieldIndex?: Int32;
}

export interface PivotDataFieldProto {
  field: Int32;
  name?: string;
  subtotal?: string;
  numberFormatId?: Int32;
  showAs?: string;
  baseField?: Int32;
  baseItem?: Int32;
  subtotalEnum?: DataConsolidateFunction;
}

export interface PivotPageFieldProto {
  field: Int32;
  item?: Int32;
  name?: string;
  hierarchy?: Int32;
}

export interface PivotFilterProto {
  field: Int32;
  type: string;
  name?: string;
  description?: string;
  typeEnum?: PivotFilterType;
}

export interface SlicerProto {
  name: string;
  caption: string;
  cache: string;
  lockedPosition?: boolean;
  displayHeader?: boolean;
  showNoDataItems?: boolean;
  sortBy?: string;
  style?: string;
  fromAnchor?: AnchorMarkerProto;
  toAnchor?: AnchorMarkerProto;
  cacheId?: Int32;
  width?: number;
  height?: number;
  isMultiSelect?: boolean;
  fill?: FillProto;
  line?: unknown;
  headerTextStyle?: unknown;
  sortByEnum?: SlicerSortBy;
}

export interface SlicerCacheProto {
  name: string;
  caption?: string;
  sourceName?: string;
  type?: string;
  pivotCacheId?: Int32;
  pivotTableIds: Int32[];
  tableId?: Int32;
  tableName?: string;
  columnName?: string;
  crossFilter?: string;
  sortOrder?: string;
  items: SlicerCacheItemProto[];
  typeEnum?: SlicerCacheType;
  crossFilterEnum?: SlicerCrossFilter;
}

export interface SlicerCacheItemProto {
  index?: Int32;
  value: string;
  selected?: boolean;
  hasData?: boolean;
  hidden?: boolean;
}

export interface TimelineProto {
  name: string;
  caption: string;
  cache: string;
  fromAnchor?: AnchorMarkerProto;
  toAnchor?: AnchorMarkerProto;
  cacheId?: Int32;
  width?: number;
  height?: number;
  fill?: FillProto;
  line?: unknown;
}

export interface TimelineCacheProto {
  name: string;
  caption?: string;
  pivotCacheId?: Int32;
  pivotTableIds: Int32[];
  columnName?: string;
  items: TimelineCacheItemProto[];
}

export interface TimelineCacheItemProto {
  index?: Int32;
  value: string;
  selected?: boolean;
}

export interface SparklineGroupsProto {
  groups: SparklineGroupProto[];
}

export interface SparklineGroupProto {
  uid?: string;
  manualMax?: number;
  manualMin?: number;
  lineWeight?: number;
  type?: SparklineType;
  dateAxis?: boolean;
  displayEmptyCellsAs?: SparklineDisplayBlanksAs;
  markers?: boolean;
  high?: boolean;
  low?: boolean;
  first?: boolean;
  last?: boolean;
  negative?: boolean;
  displayXAxis?: boolean;
  displayHidden?: boolean;
  minAxisType?: SparklineAxisMinMax;
  maxAxisType?: SparklineAxisMinMax;
  rightToLeft?: boolean;
  seriesColor?: ColorProto;
  negativeColor?: ColorProto;
  axisColor?: ColorProto;
  markersColor?: ColorProto;
  firstMarkerColor?: ColorProto;
  lastMarkerColor?: ColorProto;
  highMarkerColor?: ColorProto;
  lowMarkerColor?: ColorProto;
  formula?: string;
  sparklines: SparklineProto[];
}

export interface SparklineProto {
  formula?: string;
  reference?: string;
}

export interface PersonProto {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  type?: PersonType;
}

export interface ThreadProto {
  id: string;
  target?: unknown;
  comments: CommentProto[];
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface CommentProto {
  id: string;
  parentId?: string;
  authorId: string;
  createdAt: string;
  editedAt?: string;
  body?: unknown;
  isDeleted: boolean;
}

export interface NoteProto {
  id: string;
  target?: unknown;
  authorId: string;
  createdAt: string;
  body?: unknown;
}

export enum CellDataType {
  CELL_DATA_TYPE_UNSPECIFIED = 0,
  CELL_DATA_TYPE_SHARED_STRING = 1,
  CELL_DATA_TYPE_INLINE_STRING = 2,
  CELL_DATA_TYPE_STRING = 3,
  CELL_DATA_TYPE_BOOLEAN = 4,
  CELL_DATA_TYPE_NUMBER = 5,
  CELL_DATA_TYPE_ERROR = 6,
  CELL_DATA_TYPE_DATE = 7,
  UNRECOGNIZED = -1,
}

export enum CellFormulaType {
  CELL_FORMULA_TYPE_UNSPECIFIED = 0,
  CELL_FORMULA_TYPE_NORMAL = 1,
  CELL_FORMULA_TYPE_ARRAY = 2,
  CELL_FORMULA_TYPE_DATA_TABLE = 3,
  CELL_FORMULA_TYPE_SHARED = 4,
  UNRECOGNIZED = -1,
}

export enum DataValidationType {
  DATA_VALIDATION_TYPE_UNSPECIFIED = 0,
  DATA_VALIDATION_TYPE_NONE = 1,
  DATA_VALIDATION_TYPE_WHOLE = 2,
  DATA_VALIDATION_TYPE_DECIMAL = 3,
  DATA_VALIDATION_TYPE_LIST = 4,
  DATA_VALIDATION_TYPE_DATE = 5,
  DATA_VALIDATION_TYPE_TIME = 6,
  DATA_VALIDATION_TYPE_TEXT_LENGTH = 7,
  DATA_VALIDATION_TYPE_CUSTOM = 8,
  UNRECOGNIZED = -1,
}

export enum DataValidationErrorStyle {
  DATA_VALIDATION_ERROR_STYLE_UNSPECIFIED = 0,
  DATA_VALIDATION_ERROR_STYLE_STOP = 1,
  DATA_VALIDATION_ERROR_STYLE_WARNING = 2,
  DATA_VALIDATION_ERROR_STYLE_INFORMATION = 3,
  UNRECOGNIZED = -1,
}

export enum DataValidationImeMode {
  DATA_VALIDATION_IME_MODE_UNSPECIFIED = 0,
  DATA_VALIDATION_IME_MODE_NO_CONTROL = 1,
  DATA_VALIDATION_IME_MODE_OFF = 2,
  DATA_VALIDATION_IME_MODE_ON = 3,
  DATA_VALIDATION_IME_MODE_DISABLED = 4,
  DATA_VALIDATION_IME_MODE_HIRAGANA = 5,
  DATA_VALIDATION_IME_MODE_FULL_KATAKANA = 6,
  DATA_VALIDATION_IME_MODE_HALF_KATAKANA = 7,
  DATA_VALIDATION_IME_MODE_FULL_ALPHA = 8,
  DATA_VALIDATION_IME_MODE_HALF_ALPHA = 9,
  DATA_VALIDATION_IME_MODE_FULL_HANGUL = 10,
  DATA_VALIDATION_IME_MODE_HALF_HANGUL = 11,
  UNRECOGNIZED = -1,
}

export enum DataValidationOperator {
  DATA_VALIDATION_OPERATOR_UNSPECIFIED = 0,
  DATA_VALIDATION_OPERATOR_BETWEEN = 1,
  DATA_VALIDATION_OPERATOR_NOT_BETWEEN = 2,
  DATA_VALIDATION_OPERATOR_EQUAL = 3,
  DATA_VALIDATION_OPERATOR_NOT_EQUAL = 4,
  DATA_VALIDATION_OPERATOR_LESS_THAN = 5,
  DATA_VALIDATION_OPERATOR_LESS_THAN_OR_EQUAL = 6,
  DATA_VALIDATION_OPERATOR_GREATER_THAN = 7,
  DATA_VALIDATION_OPERATOR_GREATER_THAN_OR_EQUAL = 8,
  UNRECOGNIZED = -1,
}

export enum PivotAxis {
  PIVOT_AXIS_UNSPECIFIED = 0,
  PIVOT_AXIS_ROW = 1,
  PIVOT_AXIS_COLUMN = 2,
  PIVOT_AXIS_PAGE = 3,
  PIVOT_AXIS_VALUES = 4,
  UNRECOGNIZED = -1,
}

export enum FieldSort {
  FIELD_SORT_UNSPECIFIED = 0,
  FIELD_SORT_MANUAL = 1,
  FIELD_SORT_ASCENDING = 2,
  FIELD_SORT_DESCENDING = 3,
  UNRECOGNIZED = -1,
}

export enum DataConsolidateFunction {
  DATA_CONSOLIDATE_FUNCTION_UNSPECIFIED = 0,
  DATA_CONSOLIDATE_FUNCTION_SUM = 1,
  DATA_CONSOLIDATE_FUNCTION_AVERAGE = 2,
  DATA_CONSOLIDATE_FUNCTION_COUNT = 3,
  DATA_CONSOLIDATE_FUNCTION_COUNT_NUMBERS = 4,
  DATA_CONSOLIDATE_FUNCTION_MAXIMUM = 5,
  DATA_CONSOLIDATE_FUNCTION_MINIMUM = 6,
  DATA_CONSOLIDATE_FUNCTION_PRODUCT = 7,
  DATA_CONSOLIDATE_FUNCTION_STD_DEV = 8,
  DATA_CONSOLIDATE_FUNCTION_STD_DEVP = 9,
  DATA_CONSOLIDATE_FUNCTION_VARIANCE = 10,
  DATA_CONSOLIDATE_FUNCTION_VARIANCEP = 11,
  UNRECOGNIZED = -1,
}

export enum PivotFilterType {
  PIVOT_FILTER_TYPE_UNSPECIFIED = 0,
  PIVOT_FILTER_TYPE_UNKNOWN = 1,
  PIVOT_FILTER_TYPE_COUNT = 2,
  PIVOT_FILTER_TYPE_PERCENT = 3,
  PIVOT_FILTER_TYPE_SUM = 4,
  PIVOT_FILTER_TYPE_CAPTION_EQUAL = 5,
  PIVOT_FILTER_TYPE_CAPTION_NOT_EQUAL = 6,
  PIVOT_FILTER_TYPE_CAPTION_BEGINS_WITH = 7,
  PIVOT_FILTER_TYPE_CAPTION_ENDS_WITH = 8,
  PIVOT_FILTER_TYPE_CAPTION_CONTAINS = 9,
  PIVOT_FILTER_TYPE_VALUE_EQUAL = 10,
  PIVOT_FILTER_TYPE_VALUE_NOT_EQUAL = 11,
  PIVOT_FILTER_TYPE_VALUE_GREATER_THAN = 12,
  PIVOT_FILTER_TYPE_VALUE_LESS_THAN = 13,
  PIVOT_FILTER_TYPE_DATE_EQUAL = 14,
  PIVOT_FILTER_TYPE_TODAY = 15,
  PIVOT_FILTER_TYPE_YESTERDAY = 16,
  PIVOT_FILTER_TYPE_TOMORROW = 17,
  PIVOT_FILTER_TYPE_THIS_MONTH = 18,
  PIVOT_FILTER_TYPE_LAST_MONTH = 19,
  PIVOT_FILTER_TYPE_NEXT_MONTH = 20,
  PIVOT_FILTER_TYPE_THIS_YEAR = 21,
  PIVOT_FILTER_TYPE_LAST_YEAR = 22,
  PIVOT_FILTER_TYPE_NEXT_YEAR = 23,
  PIVOT_FILTER_TYPE_YEAR_TO_DATE = 24,
  UNRECOGNIZED = -1,
}

export enum SlicerSortBy {
  SLICER_SORT_BY_UNSPECIFIED = 0,
  SLICER_SORT_BY_DATA_SOURCE_ORDER = 1,
  SLICER_SORT_BY_ASCENDING = 2,
  SLICER_SORT_BY_DESCENDING = 3,
  UNRECOGNIZED = -1,
}

export enum SlicerCacheType {
  SLICER_CACHE_TYPE_UNSPECIFIED = 0,
  SLICER_CACHE_TYPE_PIVOT = 1,
  SLICER_CACHE_TYPE_TABLE = 2,
  UNRECOGNIZED = -1,
}

export enum SlicerCrossFilter {
  SLICER_CROSS_FILTER_UNSPECIFIED = 0,
  SLICER_CROSS_FILTER_NONE = 1,
  SLICER_CROSS_FILTER_SHOW_ITEMS_WITH_DATA_AT_TOP = 2,
  UNRECOGNIZED = -1,
}

export enum SparklineType {
  SPARKLINE_TYPE_UNSPECIFIED = 0,
  SPARKLINE_TYPE_LINE = 1,
  SPARKLINE_TYPE_COLUMN = 2,
  SPARKLINE_TYPE_STACKED = 3,
  UNRECOGNIZED = -1,
}

export enum SparklineAxisMinMax {
  SPARKLINE_AXIS_MIN_MAX_UNSPECIFIED = 0,
  SPARKLINE_AXIS_MIN_MAX_INDIVIDUAL = 1,
  SPARKLINE_AXIS_MIN_MAX_GROUP = 2,
  SPARKLINE_AXIS_MIN_MAX_CUSTOM = 3,
  UNRECOGNIZED = -1,
}

export enum SparklineDisplayBlanksAs {
  SPARKLINE_DISPLAY_BLANKS_AS_UNSPECIFIED = 0,
  SPARKLINE_DISPLAY_BLANKS_AS_SPAN = 1,
  SPARKLINE_DISPLAY_BLANKS_AS_GAP = 2,
  SPARKLINE_DISPLAY_BLANKS_AS_ZERO = 3,
  UNRECOGNIZED = -1,
}

export enum PersonType {
  PERSON_TYPE_UNSPECIFIED = 0,
  PERSON_TYPE_LIST = 1,
  PERSON_TYPE_COMMENTS_AUTHOR = 2,
  UNRECOGNIZED = -1,
}

export interface SpreadsheetProtoCodecs {
  Workbook: ProtoCodec<WorkbookProto>;
  Sheet: ProtoCodec<SheetProto>;
  Row: ProtoCodec<RowProto>;
  Cell: ProtoCodec<CellProto>;
  Styles: ProtoCodec<StylesProto>;
  Column: ProtoCodec<ColumnProto>;
  Table: ProtoCodec<TableProto>;
  TableColumn: ProtoCodec<TableColumnProto>;
  TableStyleInfo: ProtoCodec<TableStyleInfoProto>;
  AutoFilter: ProtoCodec<AutoFilterProto>;
  FilterColumn: ProtoCodec<FilterColumnProto>;
  FilterValues: ProtoCodec<FilterValuesProto>;
  DataValidations: ProtoCodec<DataValidationsProto>;
  DataValidation: ProtoCodec<DataValidationProto>;
  ConditionalFormatting: ProtoCodec<ConditionalFormattingProto>;
  CfRule: ProtoCodec<CfRuleProto>;
  SharedFormula: ProtoCodec<SharedFormulaProto>;
  Drawing: ProtoCodec<DrawingProto>;
  PivotTable: ProtoCodec<PivotTableProto>;
  PivotTableLocation: ProtoCodec<PivotTableLocationProto>;
  PivotCache: ProtoCodec<PivotCacheProto>;
  CacheField: ProtoCodec<CacheFieldProto>;
  SharedItems: ProtoCodec<SharedItemsProto>;
  FieldGroup: ProtoCodec<FieldGroupProto>;
  PivotField: ProtoCodec<PivotFieldProto>;
  PivotFieldItem: ProtoCodec<PivotFieldItemProto>;
  PivotDataField: ProtoCodec<PivotDataFieldProto>;
  PivotPageField: ProtoCodec<PivotPageFieldProto>;
  PivotFilter: ProtoCodec<PivotFilterProto>;
  Slicer: ProtoCodec<SlicerProto>;
  SlicerCache: ProtoCodec<SlicerCacheProto>;
  SlicerCacheItem: ProtoCodec<SlicerCacheItemProto>;
  Timeline: ProtoCodec<TimelineProto>;
  TimelineCache: ProtoCodec<TimelineCacheProto>;
  TimelineCacheItem: ProtoCodec<TimelineCacheItemProto>;
  SparklineGroups: ProtoCodec<SparklineGroupsProto>;
  SparklineGroup: ProtoCodec<SparklineGroupProto>;
  Sparkline: ProtoCodec<SparklineProto>;
  Person: ProtoCodec<PersonProto>;
  Thread: ProtoCodec<ThreadProto>;
  Comment: ProtoCodec<CommentProto>;
  Note: ProtoCodec<NoteProto>;
}
