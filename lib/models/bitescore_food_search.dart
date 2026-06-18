class BiteScoreFoodSearch {
  static final Map<String, Set<String>> _aliasTermsByTerm =
      _buildAliasTermsByTerm(
        symmetricGroups: _aliasGroups,
        directionalGroups: _directionalAliasGroups,
      );
  static final Set<String> _knownAliasTerms = _aliasTermsByTerm.keys.toSet();

  static String normalize(String value) {
    final withoutDiacritics = _removeDiacritics(value);
    return withoutDiacritics
        .trim()
        .toLowerCase()
        .replaceAll('&', ' and ')
        .replaceAll(RegExp(r"[\u2018\u2019\u201B\u2032']"), '')
        .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }

  static Set<String> termsFor(String value) {
    final normalized = normalize(value);
    if (normalized.isEmpty) {
      return const <String>{};
    }

    final terms = <String>{normalized};
    final tokens = normalized
        .split(' ')
        .where((token) => token.isNotEmpty)
        .toList(growable: false);
    if (tokens.length > 1) {
      terms.add(tokens.join());
      final singularLast = _singular(tokens.last);
      if (singularLast != tokens.last) {
        terms.add([...tokens.take(tokens.length - 1), singularLast].join(' '));
      }
    }

    for (final token in tokens) {
      terms.add(token);
      terms.add(_singular(token));
    }

    return terms.where((term) => term.isNotEmpty).toSet();
  }

  static bool matchesPlainText(String source, String query) {
    final normalizedSource = normalize(source);
    final normalizedQuery = normalize(query);
    if (normalizedQuery.isEmpty) {
      return true;
    }
    if (normalizedSource.contains(normalizedQuery)) {
      return true;
    }

    final sourceTerms = termsFor(normalizedSource);
    final queryTerms = _meaningfulQueryTerms(normalizedQuery);
    if (queryTerms.isEmpty) {
      return false;
    }
    return _tokensMatch(
      queryTerms: queryTerms,
      sourceTerms: sourceTerms,
      enableAliases: false,
      enableFuzzy: false,
    );
  }

  static bool matchesFoodText(
    String source,
    String query, {
    bool enableFuzzy = false,
  }) {
    return matchesAnyFoodText([source], query, enableFuzzy: enableFuzzy);
  }

  static bool matchesAnyFoodText(
    Iterable<String?> sources,
    String query, {
    bool enableFuzzy = false,
  }) {
    final normalizedQuery = normalize(query);
    if (normalizedQuery.isEmpty) {
      return true;
    }

    final sourceTerms = <String>{};
    final normalizedSources = <String>[];
    for (final source in sources) {
      final normalizedSource = normalize(source ?? '');
      if (normalizedSource.isEmpty) {
        continue;
      }
      normalizedSources.add(normalizedSource);
      sourceTerms.addAll(termsFor(normalizedSource));
    }
    if (sourceTerms.isEmpty) {
      return false;
    }

    if (normalizedSources.any((source) => source == normalizedQuery) ||
        (normalizedQuery.length >= 4 &&
            normalizedSources.any(
              (source) => source.contains(normalizedQuery),
            ))) {
      return true;
    }

    final fullAliasCandidates = _expandedAliasTerms(normalizedQuery);
    if (_sourceMatchesAnyCandidate(sourceTerms, fullAliasCandidates)) {
      return true;
    }

    final queryTerms = _meaningfulQueryTerms(normalizedQuery);
    if (queryTerms.isEmpty) {
      return false;
    }

    return _tokensMatch(
      queryTerms: queryTerms,
      sourceTerms: sourceTerms,
      enableAliases: true,
      enableFuzzy: enableFuzzy,
    );
  }

  static bool _tokensMatch({
    required List<String> queryTerms,
    required Set<String> sourceTerms,
    required bool enableAliases,
    required bool enableFuzzy,
  }) {
    return queryTerms.every((queryTerm) {
      final candidates = <String>{
        queryTerm,
        _singular(queryTerm),
        if (enableAliases) ..._expandedAliasTerms(queryTerm),
      };

      if (_sourceMatchesAnyCandidate(sourceTerms, candidates)) {
        return true;
      }

      if (!enableFuzzy || queryTerm.length < 4) {
        return false;
      }

      final fuzzyCandidates = <String>{};
      for (final aliasTerm in _knownAliasTerms) {
        if (_isConservativeFuzzyMatch(queryTerm, aliasTerm)) {
          fuzzyCandidates.add(aliasTerm);
          if (enableAliases) {
            fuzzyCandidates.addAll(_expandedAliasTerms(aliasTerm));
          }
        }
      }
      for (final sourceTerm in sourceTerms) {
        if (_isConservativeFuzzyMatch(queryTerm, sourceTerm)) {
          fuzzyCandidates.add(sourceTerm);
        }
      }

      return _sourceMatchesAnyCandidate(sourceTerms, fuzzyCandidates);
    });
  }

  static bool _sourceMatchesAnyCandidate(
    Set<String> sourceTerms,
    Set<String> candidates,
  ) {
    for (final candidate in candidates) {
      if (candidate.isEmpty) {
        continue;
      }
      if (sourceTerms.contains(candidate)) {
        return true;
      }
      if (candidate.length >= 4 &&
          sourceTerms.any((sourceTerm) => sourceTerm.contains(candidate))) {
        return true;
      }
      if (candidate.contains(' ') && sourceTerms.contains(candidate.joined)) {
        return true;
      }
    }
    return false;
  }

  static Set<String> _expandedAliasTerms(String term) {
    final expanded = _aliasTermsByTerm[term];
    return expanded ?? const <String>{};
  }

  static List<String> _meaningfulQueryTerms(String normalizedQuery) {
    final fullTerms = termsFor(normalizedQuery);
    if (normalizedQuery.contains(' ')) {
      final tokens = normalizedQuery
          .split(' ')
          .where(
            (token) => token.isNotEmpty && !_searchStopWords.contains(token),
          )
          .toList(growable: false);
      return tokens.isEmpty ? [normalizedQuery] : tokens;
    }
    return fullTerms
        .where((term) => !_searchStopWords.contains(term))
        .toList(growable: false);
  }

  static bool _isConservativeFuzzyMatch(String query, String candidate) {
    if (query == candidate || query.length < 4 || candidate.length < 4) {
      return query == candidate;
    }
    if ((query.length - candidate.length).abs() > 2) {
      return false;
    }
    if (query[0] != candidate[0]) {
      return false;
    }

    final maxDistance = _maxEditDistance(query.length);
    final distance = _damerauLevenshteinDistance(
      query,
      candidate,
      maxDistance: maxDistance,
    );
    if (distance > maxDistance) {
      return false;
    }

    final longest = query.length > candidate.length
        ? query.length
        : candidate.length;
    final similarity = (longest - distance) / longest;
    return similarity >= 0.72;
  }

  static int _maxEditDistance(int length) {
    if (length <= 3) {
      return 0;
    }
    if (length <= 6) {
      return 1;
    }
    return 2;
  }

  static int _damerauLevenshteinDistance(
    String a,
    String b, {
    required int maxDistance,
  }) {
    final matrix = List<List<int>>.generate(
      a.length + 1,
      (_) => List<int>.filled(b.length + 1, 0),
    );
    for (var i = 0; i <= a.length; i++) {
      matrix[i][0] = i;
    }
    for (var j = 0; j <= b.length; j++) {
      matrix[0][j] = j;
    }

    for (var i = 1; i <= a.length; i++) {
      var rowMin = matrix[i][0];
      for (var j = 1; j <= b.length; j++) {
        final cost = a.codeUnitAt(i - 1) == b.codeUnitAt(j - 1) ? 0 : 1;
        var value = _min3(
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
          matrix[i - 1][j - 1] + cost,
        );
        if (i > 1 &&
            j > 1 &&
            a.codeUnitAt(i - 1) == b.codeUnitAt(j - 2) &&
            a.codeUnitAt(i - 2) == b.codeUnitAt(j - 1)) {
          final transposed = matrix[i - 2][j - 2] + 1;
          if (transposed < value) {
            value = transposed;
          }
        }
        matrix[i][j] = value;
        if (value < rowMin) {
          rowMin = value;
        }
      }
      if (rowMin > maxDistance) {
        return maxDistance + 1;
      }
    }

    return matrix[a.length][b.length];
  }

  static int _min3(int a, int b, int c) {
    var min = a < b ? a : b;
    if (c < min) {
      min = c;
    }
    return min;
  }

  static Map<String, Set<String>> _buildAliasTermsByTerm({
    required List<List<String>> symmetricGroups,
    required List<_DirectionalAliasGroup> directionalGroups,
  }) {
    final map = <String, Set<String>>{};
    for (final group in symmetricGroups) {
      // Alias groups are intentionally symmetric: any term in a reviewed
      // group can match every other normalized term in that same group.
      final lookupTerms = <String>{};
      final expandedTerms = <String>{};
      for (final alias in group) {
        lookupTerms.addAll(termsFor(alias));
        expandedTerms.addAll(_aliasValueTerms(alias));
      }
      for (final term in lookupTerms.where(_isSafeAliasLookupTerm)) {
        map[term] = {...?map[term], ...expandedTerms};
      }
    }

    for (final group in directionalGroups) {
      // Directional groups are one-way: source terms expand to target terms,
      // but target terms do not expand back to the source.
      final lookupTerms = <String>{};
      final expandedTerms = <String>{};
      for (final alias in group.from) {
        lookupTerms.addAll(termsFor(alias));
        expandedTerms.addAll(_aliasValueTerms(alias));
      }
      for (final alias in group.to) {
        expandedTerms.addAll(_aliasValueTerms(alias));
      }
      for (final term in lookupTerms.where(_isSafeAliasLookupTerm)) {
        map[term] = {...?map[term], ...expandedTerms};
      }
    }
    return map;
  }

  static bool _isSafeAliasLookupTerm(String term) {
    return term.contains(' ') || term.length >= 2;
  }

  static Set<String> _aliasValueTerms(String alias) {
    final normalized = normalize(alias);
    if (normalized.isEmpty) {
      return const <String>{};
    }
    final terms = <String>{normalized};
    final tokens = normalized.split(' ');
    if (tokens.length > 1) {
      terms.add(tokens.join());
      final singularLast = _singular(tokens.last);
      if (singularLast != tokens.last) {
        terms.add([...tokens.take(tokens.length - 1), singularLast].join(' '));
      }
    } else {
      terms.add(_singular(normalized));
    }
    return terms;
  }

  static String _singular(String value) {
    if (value.length > 3 && value.endsWith('ies')) {
      return '${value.substring(0, value.length - 3)}y';
    }
    if (value.length > 4 &&
        (value.endsWith('ches') ||
            value.endsWith('shes') ||
            value.endsWith('sses') ||
            value.endsWith('xes') ||
            value.endsWith('zes'))) {
      return value.substring(0, value.length - 2);
    }
    if (value.length > 3 && value.endsWith('s')) {
      return value.substring(0, value.length - 1);
    }
    return value;
  }

  static String _removeDiacritics(String value) {
    const replacements = <String, String>{
      'á': 'a',
      'à': 'a',
      'â': 'a',
      'ä': 'a',
      'ã': 'a',
      'å': 'a',
      'ā': 'a',
      'ă': 'a',
      'ą': 'a',
      'ç': 'c',
      'ć': 'c',
      'č': 'c',
      'ď': 'd',
      'é': 'e',
      'è': 'e',
      'ê': 'e',
      'ë': 'e',
      'ē': 'e',
      'ė': 'e',
      'ę': 'e',
      'í': 'i',
      'ì': 'i',
      'î': 'i',
      'ï': 'i',
      'ī': 'i',
      'ñ': 'n',
      'ń': 'n',
      'ó': 'o',
      'ò': 'o',
      'ô': 'o',
      'ö': 'o',
      'õ': 'o',
      'ø': 'o',
      'ō': 'o',
      'ở': 'o',
      'ớ': 'o',
      'ờ': 'o',
      'ợ': 'o',
      'ơ': 'o',
      'ú': 'u',
      'ù': 'u',
      'û': 'u',
      'ü': 'u',
      'ū': 'u',
      'ư': 'u',
      'ý': 'y',
      'ÿ': 'y',
      'ž': 'z',
      'ß': 'ss',
    };
    var result = value;
    replacements.forEach((from, to) {
      result = result.replaceAll(from, to).replaceAll(from.toUpperCase(), to);
    });
    return result;
  }

  static const Set<String> _searchStopWords = {'and', 'the', 'with'};

  static const List<String> _genericSandwichAliases = [
    'sandwich',
    'sandwiches',
  ];

  static const List<String> _specificSubFamilyAliases = [
    'sub',
    'subs',
    'submarine',
    'submarine sandwich',
    'hoagie',
    'hoagies',
    'grinder',
    'grinders',
    'hero',
    'heroes',
  ];

  static const List<_DirectionalAliasGroup> _directionalAliasGroups = [
    _DirectionalAliasGroup(
      from: _genericSandwichAliases,
      to: _specificSubFamilyAliases,
    ),
  ];

  static const List<List<String>> _aliasGroups = [
    _specificSubFamilyAliases,
    ['coleslaw', 'cole slaw', 'slaw'],
    [
      'burger',
      'burgers',
      'hamburger',
      'hamburgers',
      'cheeseburger',
      'cheeseburgers',
      'bacon cheeseburger',
      'bacon burger',
      'smashburger',
      'smash burger',
      'smashed burger',
    ],
    [
      'mozzarella stick',
      'mozzarella sticks',
      'mozz stick',
      'mozz sticks',
      'moz stick',
      'moz sticks',
      'cheese stick',
      'cheese sticks',
      'fried mozzarella',
      'mozzarella fingers',
    ],
    ['bbq', 'barbecue', 'barbeque', 'bar b q', 'bar b que'],
    [
      'hot dog',
      'hot dogs',
      'hotdog',
      'hotdogs',
      'frankfurter',
      'frankfurters',
      'frank',
      'franks',
      'wiener',
      'wieners',
    ],
    [
      'macaroni and cheese',
      'macaroni & cheese',
      'mac and cheese',
      'mac & cheese',
      'mac n cheese',
      "mac 'n' cheese",
    ],
    [
      'chicken tender',
      'chicken tenders',
      'chicken strip',
      'chicken strips',
      'chicken finger',
      'chicken fingers',
    ],
    ['chicken nugget', 'chicken nuggets', 'nuggets', 'chicken bites'],
    [
      'wing',
      'wings',
      'chicken wing',
      'chicken wings',
      'buffalo wing',
      'buffalo wings',
      'hot wing',
      'hot wings',
    ],
    ['donut', 'donuts', 'doughnut', 'doughnuts'],
    [
      'pancake',
      'pancakes',
      'hotcake',
      'hotcakes',
      'flapjack',
      'flapjacks',
      'griddlecake',
      'griddlecakes',
      'griddle cake',
      'griddle cakes',
    ],
    ['omelet', 'omelets', 'omelette', 'omelettes'],
    [
      'milkshake',
      'milkshakes',
      'milk shake',
      'milk shakes',
      'shake',
      'shakes',
      'malt',
      'malts',
      'malted shake',
      'malted shakes',
    ],
    [
      'soda',
      'sodas',
      'soft drink',
      'soft drinks',
      'pop',
      'soda pop',
      'fountain drink',
      'fountain drinks',
      'fountain soda',
    ],
    ['kebab', 'kebabs', 'kabob', 'kabobs', 'kebob', 'kebobs'],
    ['hummus', 'humus', 'houmous'],
    ['shawarma', 'shawerma', 'shwarma'],
    ['shrimp', 'shrimps', 'prawn', 'prawns'],
    ['crawfish', 'crayfish', 'crawdad', 'crawdads'],
    ['mahi mahi', 'mahi', 'dolphinfish'],
    [
      'po boy',
      'po boys',
      'poboy',
      'poboys',
      'poor boy sandwich',
      'poor boy sandwiches',
    ],
    ['hush puppy', 'hush puppies', 'hushpuppy', 'hushpuppies'],
    ['grits', 'hominy grits'],
    ['collard greens', 'collards'],
    ['black eyed peas', 'blackeyed peas'],
    ['green beans', 'string beans', 'snap beans'],
    ['cornbread', 'corn bread'],
    ['sweet potato', 'sweet potatoes', 'yam', 'yams'],
    [
      'grilled cheese',
      'grilled cheese sandwich',
      'toasted cheese sandwich',
      'cheese toastie',
    ],
    [
      'meatball sub',
      'meatball sandwich',
      'meatball hoagie',
      'meatball grinder',
      'meatball hero',
    ],
    [
      'cheesesteak',
      'cheesesteaks',
      'cheese steak',
      'cheese steaks',
      'philly cheesesteak',
      'philly cheese steak',
      'steak and cheese',
      'steak and cheese sandwich',
    ],
    ['cuban sandwich', 'cuban sandwiches', 'cuban', 'cubano'],
    ['ropa vieja', 'ropa viejo'],
    ['cuban tamal', 'cuban tamale', 'cuban tamales'],
    ['chicken pie', 'chicken pies', 'chicken pot pie', 'chicken pot pies'],
    ['chicken parmesan', 'chicken parm', 'chicken parmigiana'],
    ['eggplant parmesan', 'eggplant parm', 'eggplant parmigiana'],
    [
      'general tsos chicken',
      'general tso chicken',
      'general tsaos chicken',
      'general taos chicken',
      'general tao chicken',
    ],
    ['elote', 'mexican street corn', 'street corn'],
    ['guacamole', 'guac'],
    ['lo mein', 'lomein'],
    ['chow mein', 'chowmein'],
    ['pad thai', 'phad thai'],
    ['pho', 'phở'],
    ['banh mi', 'bánh mì', 'vietnamese sandwich'],
    ['lasagna', 'lasagne'],
    ['chili', 'chilli'],
    ['chile relleno', 'chili relleno', 'chile rellenos', 'chiles rellenos'],
  ];
}

extension on String {
  String get joined => replaceAll(' ', '');
}

class _DirectionalAliasGroup {
  final List<String> from;
  final List<String> to;

  const _DirectionalAliasGroup({required this.from, required this.to});
}
