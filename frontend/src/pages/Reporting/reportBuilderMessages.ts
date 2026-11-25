import type { Locale } from '../../i18n';

export interface ReportBuilderMessages {
  studioTitle: string;
  studioSubtitle: string;
  customReportsTab: string;
  openStudioBtn: string;
  backToLibrary: string;
  library: {
    myReports: string;
    sharedReports: string;
    templates: string;
    favorites: string;
    recent: string;
    newBlankReport: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptySubtitle: string;
    openBtn: string;
    duplicateBtn: string;
    renameBtn: string;
    shareBtn: string;
    deleteBtn: string;
    favoriteAdd: string;
    favoriteRemove: string;
    confirmDelete: string;
    versionBadge: string;
    visibilityPrivate: string;
    visibilityShared: string;
    visibilityTemplate: string;
    lastRun: string;
    neverRun: string;
    useTemplate: string;
  };
  toolbar: {
    reportNameLabel: string;
    reportNamePlaceholder: string;
    dataSourceBadge: string;
    undo: string;
    redo: string;
    runReport: string;
    running: string;
    save: string;
    saveAs: string;
    saving: string;
    refresh: string;
    reset: string;
    share: string;
    exportBtn: string;
    exportCsv: string;
    exportExcel: string;
    exportPdf: string;
    exportAsync: string;
    exportJobPending: string;
    exportJobDone: string;
    exportJobDownload: string;
    fullscreen: string;
    exitFullscreen: string;
    toggleExplorer: string;
    toggleConfig: string;
    savedSuccess: string;
    unsavedChanges: string;
    moreActions: string;
  };
  explorer: {
    title: string;
    primaryEntity: string;
    relatedEntities: string;
    noRelatedEntities: string;
    toggleRelated: string;
    sourcePrefix: string;
    searchFields: string;
    calculatedFieldsTitle: string;
    addCalculatedField: string;
    editCalculatedField: string;
    deleteCalculatedField: string;
    noFieldsFound: string;
    dragHint: string;
    quickAddColumns: string;
    quickAddRows: string;
    quickAddPivot: string;
    quickAddValues: string;
    quickAddFilter: string;
    types: {
      string: string;
      number: string;
      currency: string;
      date: string;
      boolean: string;
      enum: string;
    };
  };
  config: {
    title: string;
    subtitle: string;
    tabFields: string;
    tabCustomize: string;
    addFieldInline: string;
    zones: {
      columns: string;
      rows: string;
      pivotColumns: string;
      values: string;
      groupBy: string;
      filters: string;
      sortBy: string;
    };
    zoneHints: {
      columns: string;
      rows: string;
      pivotColumns: string;
      values: string;
      groupBy: string;
      filters: string;
      sortBy: string;
    };
    dropHere: string;
    incompatibleField: string;
    duplicateValue: string;
    removeField: string;
    moveUp: string;
    moveDown: string;
    renameLabel: string;
    aggregationLabel: string;
    granularityLabel: string;
    formatLabel: string;
    sortAsc: string;
    sortDesc: string;
    sections: {
      fieldSettings: string;
      visualizationSettings: string;
      formattingRules: string;
      advancedOptions: string;
    };
    showSubtotals: string;
    showGrandTotal: string;
    conditionalRules: string;
    addRule: string;
    rowLimitLabel: string;
    defaultLabel: string;
    chartOptions: {
      showLegend: string;
      showDataLabels: string;
      smoothLine: string;
      paletteLabel: string;
      colorDefault: string;
      colorEmerald: string;
      colorViolet: string;
      colorWarm: string;
      kpiTitleLabel: string;
      kpiPrefixLabel: string;
      kpiSuffixLabel: string;
    };
    granularities: {
      NONE: string;
      DAY: string;
      WEEK: string;
      MONTH: string;
      QUARTER: string;
      YEAR: string;
    };
    formats: {
      text: string;
      number: string;
      currency: string;
      percent: string;
      date: string;
      datetime: string;
      boolean: string;
    };
    toneLabels: {
      success: string;
      warning: string;
      danger: string;
      info: string;
    };
  };
  aggregations: Record<string, string>;
  canvas: {
    kpiTitle: string;
    kpiSummary: string;
    visualSummary: string;
    previewSubtitle: string;
    tabTable: string;
    tabPivot: string;
    tabChart: string;
    chartTypeLabel: string;
    views: {
      TABLE: string;
      PIVOT: string;
      BAR: string;
      COLUMN: string;
      LINE: string;
      AREA: string;
      PIE: string;
      DONUT: string;
      STACKED_BAR: string;
      COMBO: string;
      HEATMAP: string;
      KPI: string;
    };
    emptyPromptTitle: string;
    emptyPromptBody: string;
    runNowHint: string;
    totalRows: string;
    cachedBadge: string;
    executionMs: string;
    grandTotal: string;
    subtotalLabel: string;
    expandGroup: string;
    collapseGroup: string;
    drilldownAction: string;
    drilldownTitle: string;
    drilldownEmpty: string;
    chartNeedsMeasure: string;
    chartNeedsDimension: string;
    pageInfo: string;
    prevPage: string;
    nextPage: string;
    pageSizeLabel: string;
    resizeColumn: string;
    sortColumn: string;
    errorBannerTitle: string;
    retryBtn: string;
  };
  formulaModal: {
    title: string;
    nameLabel: string;
    namePlaceholder: string;
    expressionLabel: string;
    expressionPlaceholder: string;
    formatLabel: string;
    insertField: string;
    insertFunction: string;
    validateBtn: string;
    validBadge: string;
    inferredType: string;
    saveBtn: string;
    securityNote: string;
  };
  filterBuilder: {
    title: string;
    combinatorAnd: string;
    combinatorOr: string;
    addRule: string;
    addGroup: string;
    removeGroup: string;
    removeRule: string;
    selectField: string;
    selectOperator: string;
    valuePlaceholder: string;
    valueToPlaceholder: string;
    emptyFilterHint: string;
    operators: Record<string, string>;
    relativeDates: Record<string, string>;
  };
  shareModal: {
    title: string;
    saveAsTitle: string;
    nameLabel: string;
    descriptionLabel: string;
    changeNoteLabel: string;
    visibilityLabel: string;
    sharedRolesLabel: string;
    isTemplateLabel: string;
    confirmSave: string;
    confirmShare: string;
  };
  common: {
    close: string;
    apply: string;
    cancel: string;
    yes: string;
    no: string;
    loading: string;
  };
  responsive: {
    tabData: string;
    tabConfig: string;
    tabResult: string;
    addToZoneTitle: string;
    addToFilter: string;
    addedNotice: string;
    filterCountBtn: string;
    closePanel: string;
    tapFieldHint: string;
  };
}

export const reportBuilderMessages: Record<Locale, ReportBuilderMessages> = {
  vi: {
    studioTitle: 'Report Builder Studio',
    studioSubtitle:
      'Thiết kế báo cáo động theo thời gian thực với kéo thả, bảng Pivot, trường tính toán và biểu đồ trực quan.',
    customReportsTab: 'Báo cáo tùy chỉnh (Studio)',
    openStudioBtn: 'Tạo báo cáo mới',
    backToLibrary: 'Thư viện báo cáo',
    library: {
      myReports: 'Báo cáo của tôi',
      sharedReports: 'Được chia sẻ',
      templates: 'Mẫu báo cáo chuẩn',
      favorites: 'Yêu thích',
      recent: 'Gần đây',
      newBlankReport: 'Tạo báo cáo trống',
      searchPlaceholder: 'Tìm tên báo cáo, nguồn dữ liệu hoặc mô tả...',
      emptyTitle: 'Chưa có báo cáo nào trong mục này',
      emptySubtitle: 'Bắt đầu từ báo cáo trống hoặc nhân bản một mẫu báo cáo HR chuẩn.',
      openBtn: 'Mở trong Studio',
      duplicateBtn: 'Nhân bản',
      renameBtn: 'Đổi tên',
      shareBtn: 'Chia sẻ',
      deleteBtn: 'Xóa',
      favoriteAdd: 'Đánh dấu yêu thích',
      favoriteRemove: 'Bỏ yêu thích',
      confirmDelete: 'Bạn có chắc chắn muốn xóa báo cáo này?',
      versionBadge: 'Phiên bản',
      visibilityPrivate: 'Riêng tư',
      visibilityShared: 'Chia sẻ nội bộ',
      visibilityTemplate: 'Mẫu tổ chức',
      lastRun: 'Chạy gần nhất',
      neverRun: 'Chưa từng chạy',
      useTemplate: 'Sử dụng mẫu này',
    },
    toolbar: {
      reportNameLabel: 'Tên báo cáo',
      reportNamePlaceholder: 'Nhập tên báo cáo...',
      dataSourceBadge: 'Nguồn chính',
      undo: 'Hoàn tác',
      redo: 'Làm lại',
      runReport: 'Chạy báo cáo',
      running: 'Đang chạy...',
      save: 'Lưu',
      saveAs: 'Lưu bản mới',
      saving: 'Đang lưu...',
      refresh: 'Làm mới',
      reset: 'Đặt lại',
      share: 'Chia sẻ',
      exportBtn: 'Xuất file',
      exportCsv: 'Xuất CSV (UTF-8)',
      exportExcel: 'Xuất Excel (.xlsx)',
      exportPdf: 'Xuất PDF',
      exportAsync: 'Xuất nền (dữ liệu lớn)',
      exportJobPending: 'Đang tạo tệp xuất nền...',
      exportJobDone: 'Tệp xuất nền đã sẵn sàng!',
      exportJobDownload: 'Tải xuống ngay',
      fullscreen: 'Toàn màn hình',
      exitFullscreen: 'Thoát toàn màn hình',
      toggleExplorer: 'Khám phá dữ liệu',
      toggleConfig: 'Cấu hình báo cáo',
      savedSuccess: 'Đã lưu cấu hình báo cáo.',
      unsavedChanges: 'Có thay đổi chưa lưu',
      moreActions: 'Tùy chọn khác',
    },
    explorer: {
      title: 'Trường dữ liệu',
      primaryEntity: 'Nguồn dữ liệu chính',
      relatedEntities: 'Thông tin có thể bổ sung',
      noRelatedEntities: 'Không có bảng liên kết thêm',
      toggleRelated: 'Bảng liên kết',
      sourcePrefix: 'Nguồn',
      searchFields: 'Tìm trường dữ liệu...',
      calculatedFieldsTitle: 'Trường tính toán',
      addCalculatedField: 'Tạo công thức mới',
      editCalculatedField: 'Sửa công thức',
      deleteCalculatedField: 'Xóa công thức',
      noFieldsFound: 'Không tìm thấy trường phù hợp.',
      dragHint: 'Kéo trường sang cấu hình hoặc bấm +',
      quickAddColumns: '+ Cột hiển thị',
      quickAddRows: '+ Hàng / Nhóm',
      quickAddPivot: '+ Cột Pivot',
      quickAddValues: '+ Giá trị đo',
      quickAddFilter: '+ Bộ lọc',
      types: {
        string: 'Văn bản',
        number: 'Số',
        currency: 'Tiền tệ',
        date: 'Ngày tháng',
        boolean: 'Đúng/Sai',
        enum: 'Danh mục',
      },
    },
    config: {
      title: 'Cấu hình báo cáo',
      subtitle: 'Kéo thả trường vào các vùng',
      tabFields: 'Cấu hình vùng',
      tabCustomize: 'Tùy chỉnh',
      addFieldInline: '+ Thêm trường',
      zones: {
        columns: 'Cột hiển thị (Bảng chi tiết)',
        rows: 'Chia kết quả theo',
        pivotColumns: 'Cột xoay chiều (Pivot Columns)',
        values: 'Chỉ số và cách tính',
        groupBy: 'Nhóm để tính tổng phụ',
        filters: 'Bộ lọc nâng cao',
        sortBy: 'Sắp xếp kết quả',
      },
      zoneHints: {
        columns: 'Kéo các trường hiển thị dạng bảng chi tiết khi không nhóm.',
        rows: 'Chiều chính theo hàng ngang hoặc trục X của biểu đồ.',
        pivotColumns: 'Tạo ma trận xoay chiều (Pivot) theo giá trị của trường này.',
        values: 'Các chỉ số tổng hợp (SUM, COUNT, AVG, PERCENTAGE...).',
        groupBy: 'Gom nhóm dữ liệu đa tầng để tính tổng phụ & tổng cộng.',
        filters: 'Lọc dữ liệu với điều kiện AND / OR lồng nhau.',
        sortBy: 'Thứ tự ưu tiên sắp xếp cột hoặc chỉ số.',
      },
      dropHere: 'Kéo thả trường vào đây',
      incompatibleField: 'Trường này không tương thích với vùng đã chọn.',
      duplicateValue: 'Nhân bản chỉ số',
      removeField: 'Gỡ trường',
      moveUp: 'Di chuyển lên',
      moveDown: 'Di chuyển xuống',
      renameLabel: 'Đổi nhãn hiển thị',
      aggregationLabel: 'Phép tổng hợp',
      granularityLabel: 'Chu kỳ ngày',
      formatLabel: 'Định dạng hiển thị',
      sortAsc: 'Tăng dần (A→Z)',
      sortDesc: 'Giảm dần (Z→A)',
      sections: {
        fieldSettings: 'Thiết lập trường đang chọn',
        visualizationSettings: 'Tùy chỉnh biểu đồ & KPI',
        formattingRules: 'Định dạng có điều kiện',
        advancedOptions: 'Tùy chọn nâng cao & Tổng cộng',
      },
      showSubtotals: 'Hiển thị tổng phụ (Subtotals)',
      showGrandTotal: 'Hiển thị tổng cộng (Grand Total)',
      conditionalRules: 'Quy tắc tô màu theo ngưỡng',
      addRule: 'Thêm quy tắc',
      rowLimitLabel: 'Số dòng mỗi trang xem trước',
      defaultLabel: 'Mặc định hệ thống',
      chartOptions: {
        showLegend: 'Hiển thị chú giải (Legend)',
        showDataLabels: 'Hiển thị giá trị trên biểu đồ',
        smoothLine: 'Đường cong mượt',
        paletteLabel: 'Bảng màu biểu đồ',
        colorDefault: 'Xanh doanh nghiệp',
        colorEmerald: 'Ngọc lục bảo',
        colorViolet: 'Tím hiện đại',
        colorWarm: 'Ấm áp (Cam/Vàng)',
        kpiTitleLabel: 'Tiêu đề thẻ KPI',
        kpiPrefixLabel: 'Tiền tố KPI',
        kpiSuffixLabel: 'Hậu tố KPI',
      },
      granularities: {
        NONE: 'Nguyên ngày',
        DAY: 'Theo Ngày',
        WEEK: 'Theo Tuần',
        MONTH: 'Theo Tháng',
        QUARTER: 'Theo Quý',
        YEAR: 'Theo Năm',
      },
      formats: {
        text: 'Văn bản',
        number: 'Số chuẩn',
        currency: 'Tiền tệ (VND)',
        percent: 'Phần trăm (%)',
        date: 'Ngày (dd/mm/yyyy)',
        datetime: 'Ngày giờ',
        boolean: 'Có / Không',
      },
      toneLabels: {
        success: 'Xanh lá',
        warning: 'Vàng cam',
        danger: 'Đỏ cảnh báo',
        info: 'Xanh dương',
      },
    },
    aggregations: {
      SUM: 'Tổng (SUM)',
      COUNT: 'Đếm dòng (COUNT)',
      COUNT_DISTINCT: 'Đếm duy nhất',
      AVG: 'Trung bình (AVG)',
      MIN: 'Nhỏ nhất (MIN)',
      MAX: 'Lớn nhất (MAX)',
      MEDIAN: 'Trung vị (MEDIAN)',
      PERCENTAGE: 'Tỷ trọng (%)',
      RUNNING_TOTAL: 'Tổng lũy kế',
      RANK: 'Xếp hạng (RANK)',
      GROWTH_RATE: 'Tăng trưởng (%)',
    },
    canvas: {
      kpiTitle: 'KPI Summary',
      kpiSummary: 'Key Metrics',
      visualSummary: 'Breakdown Chart',
      previewSubtitle: 'Live Report Preview · Authorized Data',
      tabTable: 'Table',
      tabPivot: 'Pivot',
      tabChart: 'Chart',
      chartTypeLabel: 'Chart Type',
      views: {
        TABLE: 'Bảng dữ liệu',
        PIVOT: 'Bảng Pivot',
        BAR: 'Biểu đồ thanh ngang',
        COLUMN: 'Biểu đồ cột dọc',
        LINE: 'Biểu đồ đường',
        AREA: 'Biểu đồ vùng',
        PIE: 'Biểu đồ tròn',
        DONUT: 'Biểu đồ vòng Donut',
        STACKED_BAR: 'Cột chồng',
        COMBO: 'Kết hợp Cột + Đường',
        HEATMAP: 'Bản đồ nhiệt',
        KPI: 'Thẻ KPI',
      },
      emptyPromptTitle: 'Sẵn sàng xây dựng báo cáo',
      emptyPromptBody:
        'Chọn hoặc kéo các trường dữ liệu từ Khám phá dữ liệu bên trái vào Cột, Hàng hoặc Giá trị rồi nhấn Chạy báo cáo.',
      runNowHint: 'Bấm Chạy báo cáo để tải dữ liệu thực tế',
      totalRows: 'Tổng bản ghi',
      cachedBadge: 'Cache 30s',
      executionMs: 'Thời gian truy vấn',
      grandTotal: 'TỔNG CỘNG',
      subtotalLabel: 'Tổng nhóm',
      expandGroup: 'Mở rộng nhóm',
      collapseGroup: 'Thu gọn nhóm',
      drilldownAction: 'Xem chi tiết',
      drilldownTitle: 'Chi tiết bản ghi theo nhóm',
      drilldownEmpty: 'Không có bản ghi chi tiết phù hợp quyền truy cập.',
      chartNeedsMeasure:
        'Hãy thêm ít nhất 1 trường vào vùng Giá trị (Values) để hiển thị biểu đồ này.',
      chartNeedsDimension:
        'Hãy thêm ít nhất 1 trường vào Hàng hoặc Nhóm dữ liệu để hiển thị biểu đồ.',
      pageInfo: 'Trang {page} / {totalPages} ({total} dòng)',
      prevPage: 'Trước',
      nextPage: 'Sau',
      pageSizeLabel: 'Dòng/trang',
      resizeColumn: 'Kéo để đổi độ rộng cột',
      sortColumn: 'Nhấn để sắp xếp theo cột này',
      errorBannerTitle: 'Không thể thực thi báo cáo',
      retryBtn: 'Thử chạy lại',
    },
    formulaModal: {
      title: 'Trình tạo Trường tính toán (Calculated Field)',
      nameLabel: 'Tên chỉ số mới',
      namePlaceholder: 'VD: Tỷ lệ thưởng / Lương cơ bản',
      expressionLabel: 'Biểu thức công thức an toàn',
      expressionPlaceholder:
        'VD: IF([slip_base_salary] > 0, SAFE_DIV([slip_gross_pay], [slip_base_salary], 0) * 100, 0)',
      formatLabel: 'Định dạng kết quả',
      insertField: 'Chèn trường dữ liệu',
      insertFunction: 'Chèn hàm hỗ trợ',
      validateBtn: 'Kiểm tra cú pháp',
      validBadge: 'Công thức hợp lệ',
      inferredType: 'Kiểu kết quả dự kiến',
      saveBtn: 'Lưu trường tính toán',
      securityNote:
        'Trình phân tích biểu thức an toàn trên máy chủ — không cho phép SQL hay mã thực thi.',
    },
    filterBuilder: {
      title: 'Bộ lọc nâng cao (Nested AND / OR)',
      combinatorAnd: 'Thỏa mãn TẤT CẢ (AND)',
      combinatorOr: 'Thỏa mãn BẤT KỲ (OR)',
      addRule: '+ Thêm điều kiện',
      addGroup: '+ Thêm nhóm lồng',
      removeGroup: 'Xóa nhóm',
      removeRule: 'Xóa điều kiện',
      selectField: 'Chọn trường...',
      selectOperator: 'Toán tử...',
      valuePlaceholder: 'Nhập giá trị...',
      valueToPlaceholder: 'Đến giá trị...',
      emptyFilterHint:
        'Chưa có điều kiện lọc nào. Báo cáo sẽ lấy toàn bộ dữ liệu theo phạm vi quyền.',
      operators: {
        eq: 'Bằng (=)',
        neq: 'Khác (≠)',
        contains: 'Chứa từ khóa',
        not_contains: 'Không chứa',
        starts_with: 'Bắt đầu bằng',
        gt: 'Lớn hơn (>)',
        gte: 'Lớn hơn hoặc bằng (≥)',
        lt: 'Nhỏ hơn (<)',
        lte: 'Nhỏ hơn hoặc bằng (≤)',
        between: 'Trong khoảng (Between)',
        in: 'Thuộc danh sách (IN)',
        not_in: 'Không thuộc (NOT IN)',
        relative_date: 'Khoảng ngày tương đối',
        is_null: 'Rỗng / Chưa có giá trị',
        is_not_null: 'Có giá trị (Khác rỗng)',
      },
      relativeDates: {
        TODAY: 'Hôm nay',
        YESTERDAY: 'Hôm qua',
        LAST_7_DAYS: '7 ngày gần nhất',
        LAST_30_DAYS: '30 ngày gần nhất',
        THIS_MONTH: 'Tháng này',
        LAST_MONTH: 'Tháng trước',
        THIS_QUARTER: 'Quý này',
        THIS_YEAR: 'Năm nay',
        LAST_YEAR: 'Năm trước',
      },
    },
    shareModal: {
      title: 'Chia sẻ & Quyền truy cập báo cáo',
      saveAsTitle: 'Lưu báo cáo vào Thư viện',
      nameLabel: 'Tên báo cáo',
      descriptionLabel: 'Mô tả ngắn',
      changeNoteLabel: 'Ghi chú phiên bản',
      visibilityLabel: 'Phạm vi hiển thị',
      sharedRolesLabel: 'Chia sẻ với vai trò',
      isTemplateLabel: 'Đánh dấu là Mẫu báo cáo chuẩn của tổ chức',
      confirmSave: 'Lưu báo cáo',
      confirmShare: 'Cập nhật chia sẻ',
    },
    common: {
      close: 'Đóng',
      apply: 'Áp dụng',
      cancel: 'Hủy',
      yes: 'Có',
      no: 'Không',
      loading: 'Đang tải...',
    },
    responsive: {
      tabData: 'Dữ liệu',
      tabConfig: 'Cấu hình',
      tabResult: 'Kết quả',
      addToZoneTitle: 'Thêm trường vào vùng báo cáo',
      addToFilter: '+ Thêm vào Bộ lọc',
      addedNotice: 'Đã thêm "{field}" vào {zone}',
      filterCountBtn: 'Bộ lọc',
      closePanel: 'Đóng bảng',
      tapFieldHint: 'Chạm vào trường để chọn vùng thêm nhanh',
    },
  },
  en: {
    studioTitle: 'Report Builder Studio',
    studioSubtitle:
      'Build real-time custom HR reports with drag-and-drop fields, pivot matrices, calculated metrics, and interactive charts.',
    customReportsTab: 'Custom Reports (Studio)',
    openStudioBtn: 'New Custom Report',
    backToLibrary: 'Report Library',
    library: {
      myReports: 'My Reports',
      sharedReports: 'Shared with Me',
      templates: 'Templates',
      favorites: 'Favorites',
      recent: 'Recent',
      newBlankReport: 'New Blank Report',
      searchPlaceholder: 'Search report name, data source, or description...',
      emptyTitle: 'No reports in this section yet',
      emptySubtitle: 'Start from a blank canvas or duplicate a curated HR report template.',
      openBtn: 'Open in Studio',
      duplicateBtn: 'Duplicate',
      renameBtn: 'Rename',
      shareBtn: 'Share',
      deleteBtn: 'Delete',
      favoriteAdd: 'Add to favorites',
      favoriteRemove: 'Remove from favorites',
      confirmDelete: 'Are you sure you want to delete this report?',
      versionBadge: 'Version',
      visibilityPrivate: 'Private',
      visibilityShared: 'Team Shared',
      visibilityTemplate: 'Org Template',
      lastRun: 'Last run',
      neverRun: 'Not run yet',
      useTemplate: 'Use Template',
    },
    toolbar: {
      reportNameLabel: 'Report name',
      reportNamePlaceholder: 'Enter report name...',
      dataSourceBadge: 'Primary Source',
      undo: 'Undo',
      redo: 'Redo',
      runReport: 'Run Report',
      running: 'Running...',
      save: 'Save',
      saveAs: 'Save As',
      saving: 'Saving...',
      refresh: 'Refresh',
      reset: 'Reset',
      share: 'Share',
      exportBtn: 'Export',
      exportCsv: 'Export CSV (UTF-8)',
      exportExcel: 'Export Excel (.xlsx)',
      exportPdf: 'Export PDF',
      exportAsync: 'Background Export (Large)',
      exportJobPending: 'Generating background export...',
      exportJobDone: 'Background export ready!',
      exportJobDownload: 'Download File',
      fullscreen: 'Fullscreen',
      exitFullscreen: 'Exit Fullscreen',
      toggleExplorer: 'Data Explorer',
      toggleConfig: 'Configuration',
      savedSuccess: 'Report definition saved.',
      unsavedChanges: 'Unsaved changes',
      moreActions: 'More Actions',
    },
    explorer: {
      title: 'Data Fields',
      primaryEntity: 'Primary Data Source',
      relatedEntities: 'Related information you can add',
      noRelatedEntities: 'No additional related entities',
      toggleRelated: 'Linked Tables',
      sourcePrefix: 'Source',
      searchFields: 'Search data fields...',
      calculatedFieldsTitle: 'Calculated Fields',
      addCalculatedField: 'New Formula Field',
      editCalculatedField: 'Edit Formula',
      deleteCalculatedField: 'Delete Formula',
      noFieldsFound: 'No matching fields found.',
      dragHint: 'Drag fields to zones or click +',
      quickAddColumns: '+ Columns',
      quickAddRows: '+ Rows',
      quickAddPivot: '+ Pivot Cols',
      quickAddValues: '+ Values',
      quickAddFilter: '+ Filter',
      types: {
        string: 'Text',
        number: 'Number',
        currency: 'Currency',
        date: 'Date',
        boolean: 'Boolean',
        enum: 'Category',
      },
    },
    config: {
      title: 'Report Configuration',
      subtitle: 'Drag and drop fields into zones',
      tabFields: 'Fields & Zones',
      tabCustomize: 'Customize',
      addFieldInline: '+ Add field',
      zones: {
        columns: 'Display Columns (Detail Table)',
        rows: 'Split results by',
        pivotColumns: 'Pivot Columns',
        values: 'Metrics and calculations',
        groupBy: 'Groups for subtotals',
        filters: 'Filters',
        sortBy: 'Sort By',
      },
      zoneHints: {
        columns: 'Fields shown in detail tabular mode when no grouping is active.',
        rows: 'Primary row dimension or horizontal chart axis.',
        pivotColumns: 'Cross-tabulate columns across values of this dimension.',
        values: 'Aggregated metrics (SUM, COUNT, AVG, PERCENTAGE...).',
        groupBy: 'Multi-level grouping for subtotals and grand totals.',
        filters: 'Nested AND / OR filter criteria.',
        sortBy: 'Result ordering priority.',
      },
      dropHere: 'Drop field here',
      incompatibleField: 'This field is incompatible with the selected zone.',
      duplicateValue: 'Duplicate measure',
      removeField: 'Remove field',
      moveUp: 'Move up',
      moveDown: 'Move down',
      renameLabel: 'Display label override',
      aggregationLabel: 'Aggregation',
      granularityLabel: 'Date bucket',
      formatLabel: 'Display format',
      sortAsc: 'Ascending (A→Z)',
      sortDesc: 'Descending (Z→A)',
      sections: {
        fieldSettings: 'Selected Field Settings',
        visualizationSettings: 'Visualization & KPI Options',
        formattingRules: 'Conditional Formatting',
        advancedOptions: 'Advanced & Totals',
      },
      showSubtotals: 'Show Subtotals',
      showGrandTotal: 'Show Grand Total',
      conditionalRules: 'Threshold highlighting rules',
      addRule: 'Add rule',
      rowLimitLabel: 'Preview page size',
      defaultLabel: 'System Default',
      chartOptions: {
        showLegend: 'Show Legend',
        showDataLabels: 'Show Data Labels',
        smoothLine: 'Smooth Curve',
        paletteLabel: 'Chart Palette',
        colorDefault: 'Enterprise Blue',
        colorEmerald: 'Emerald Green',
        colorViolet: 'Modern Violet',
        colorWarm: 'Warm Amber',
        kpiTitleLabel: 'KPI Title Override',
        kpiPrefixLabel: 'KPI Prefix',
        kpiSuffixLabel: 'KPI Suffix',
      },
      granularities: {
        NONE: 'Exact date',
        DAY: 'Day',
        WEEK: 'Week',
        MONTH: 'Month',
        QUARTER: 'Quarter',
        YEAR: 'Year',
      },
      formats: {
        text: 'Text',
        number: 'Number',
        currency: 'Currency (VND)',
        percent: 'Percentage (%)',
        date: 'Date (dd/mm/yyyy)',
        datetime: 'Date & Time',
        boolean: 'Yes / No',
      },
      toneLabels: {
        success: 'Green',
        warning: 'Amber',
        danger: 'Red',
        info: 'Blue',
      },
    },
    aggregations: {
      SUM: 'Sum (SUM)',
      COUNT: 'Count (COUNT)',
      COUNT_DISTINCT: 'Distinct Count',
      AVG: 'Average (AVG)',
      MIN: 'Minimum (MIN)',
      MAX: 'Maximum (MAX)',
      MEDIAN: 'Median (MEDIAN)',
      PERCENTAGE: 'Share (%)',
      RUNNING_TOTAL: 'Running Total',
      RANK: 'Rank (RANK)',
      GROWTH_RATE: 'Growth Rate (%)',
    },
    canvas: {
      kpiTitle: 'KPI Summary',
      kpiSummary: 'Key Metrics',
      visualSummary: 'Breakdown Chart',
      previewSubtitle: 'Live Report Preview · Authorized Data',
      tabTable: 'Table',
      tabPivot: 'Pivot',
      tabChart: 'Chart',
      chartTypeLabel: 'Chart Type',
      views: {
        TABLE: 'Data Table',
        PIVOT: 'Pivot Table',
        BAR: 'Bar Chart',
        COLUMN: 'Column Chart',
        LINE: 'Line Chart',
        AREA: 'Area Chart',
        PIE: 'Pie Chart',
        DONUT: 'Donut Chart',
        STACKED_BAR: 'Stacked Chart',
        COMBO: 'Combo Chart',
        HEATMAP: 'Heatmap',
        KPI: 'KPI Card',
      },
      emptyPromptTitle: 'Ready to Build Your Report',
      emptyPromptBody:
        'Select or drag fields from Data Explorer into Columns, Rows, or Values, then click Run Report.',
      runNowHint: 'Click Run Report to load live authorized data',
      totalRows: 'Total Records',
      cachedBadge: 'Cached 30s',
      executionMs: 'Query Time',
      grandTotal: 'GRAND TOTAL',
      subtotalLabel: 'Subtotal',
      expandGroup: 'Expand group',
      collapseGroup: 'Collapse group',
      drilldownAction: 'Drill down',
      drilldownTitle: 'Record Drill-down',
      drilldownEmpty: 'No authorized detail records match this group.',
      chartNeedsMeasure: 'Add at least one metric to Values to render this visualization.',
      chartNeedsDimension: 'Add at least one field to Rows or Group By to render this chart.',
      pageInfo: 'Page {page} of {totalPages} ({total} rows)',
      prevPage: 'Previous',
      nextPage: 'Next',
      pageSizeLabel: 'Rows/page',
      resizeColumn: 'Drag to resize column',
      sortColumn: 'Click to sort by this column',
      errorBannerTitle: 'Report Execution Error',
      retryBtn: 'Retry',
    },
    formulaModal: {
      title: 'Calculated Field Formula Builder',
      nameLabel: 'Metric Name',
      namePlaceholder: 'e.g. Bonus to Base Ratio (%)',
      expressionLabel: 'Safe Formula Expression',
      expressionPlaceholder:
        'e.g. IF([slip_base_salary] > 0, SAFE_DIV([slip_gross_pay], [slip_base_salary], 0) * 100, 0)',
      formatLabel: 'Output Format',
      insertField: 'Insert Field',
      insertFunction: 'Insert Function',
      validateBtn: 'Validate Syntax',
      validBadge: 'Formula Valid',
      inferredType: 'Inferred Return Type',
      saveBtn: 'Save Calculated Field',
      securityNote: 'Evaluated by strict server AST parser — no SQL or arbitrary code execution.',
    },
    filterBuilder: {
      title: 'Advanced Filter Builder (Nested AND / OR)',
      combinatorAnd: 'Match ALL conditions (AND)',
      combinatorOr: 'Match ANY condition (OR)',
      addRule: '+ Add Rule',
      addGroup: '+ Add Nested Group',
      removeGroup: 'Remove Group',
      removeRule: 'Remove Rule',
      selectField: 'Select field...',
      selectOperator: 'Operator...',
      valuePlaceholder: 'Enter value...',
      valueToPlaceholder: 'To value...',
      emptyFilterHint: 'No active filters. Query will include all rows within your role scope.',
      operators: {
        eq: 'Equals (=)',
        neq: 'Not Equals (≠)',
        contains: 'Contains',
        not_contains: 'Does Not Contain',
        starts_with: 'Starts With',
        gt: 'Greater Than (>)',
        gte: 'Greater or Equal (≥)',
        lt: 'Less Than (<)',
        lte: 'Less or Equal (≤)',
        between: 'Between',
        in: 'In List (IN)',
        not_in: 'Not In List',
        relative_date: 'Relative Date Range',
        is_null: 'Is Null / Empty',
        is_not_null: 'Is Not Null',
      },
      relativeDates: {
        TODAY: 'Today',
        YESTERDAY: 'Yesterday',
        LAST_7_DAYS: 'Last 7 days',
        LAST_30_DAYS: 'Last 30 days',
        THIS_MONTH: 'This month',
        LAST_MONTH: 'Last month',
        THIS_QUARTER: 'This quarter',
        THIS_YEAR: 'This year',
        LAST_YEAR: 'Last year',
      },
    },
    shareModal: {
      title: 'Share & Access Control',
      saveAsTitle: 'Save Report to Library',
      nameLabel: 'Report Name',
      descriptionLabel: 'Short Description',
      changeNoteLabel: 'Version Change Note',
      visibilityLabel: 'Visibility Scope',
      sharedRolesLabel: 'Share with Roles',
      isTemplateLabel: 'Publish as Organization Report Template',
      confirmSave: 'Save Report',
      confirmShare: 'Save Sharing Settings',
    },
    common: {
      close: 'Close',
      apply: 'Apply',
      cancel: 'Cancel',
      yes: 'Yes',
      no: 'No',
      loading: 'Loading...',
    },
    responsive: {
      tabData: 'Data',
      tabConfig: 'Build',
      tabResult: 'Preview',
      addToZoneTitle: 'Add Field to Zone',
      addToFilter: '+ Add to Filters',
      addedNotice: 'Added "{field}" to {zone}',
      filterCountBtn: 'Filters',
      closePanel: 'Close panel',
      tapFieldHint: 'Tap a field to pick a target zone',
    },
  },
};
