#!/usr/bin/env python3
"""
Ontology Provider for Cognee Chat Memory Extension

Loads and validates the ontology.ttl file for workspace initialization.
Provides TTL parsing with RDFLib and basic validation.
"""

import json
from pathlib import Path
from typing import Any, Dict

try:
    from rdflib import Graph, Namespace, URIRef
    from rdflib.namespace import OWL, RDF, RDFS
except ImportError:
    # Graceful degradation if rdflib not available
    Graph = None
    URIRef = None
    Namespace = None
    RDF = None
    RDFS = None
    OWL = None


class OntologyLoadError(Exception):
    """Raised when ontology loading or validation fails."""
    pass


def load_ontology() -> Dict[str, Any]:
    """
    Load and parse the ontology.ttl file from the bridge directory.

    Returns:
        Dictionary containing:
        - entities: List of entity class names
        - relationships: List of relationship property names
        - raw_graph: RDFLib Graph object (if rdflib available)

    Raises:
        OntologyLoadError: If file not found, parsing fails, or validation fails
    """
    if Graph is None:
        raise OntologyLoadError(
            "rdflib library not available. Install with: pip install rdflib"
        )

    # Locate ontology.ttl relative to this script
    bridge_dir = Path(__file__).parent
    ontology_path = bridge_dir / 'ontology.ttl'

    if not ontology_path.exists():
        raise OntologyLoadError(
            f"Ontology file not found at {ontology_path}. "
            f"Expected location: extension/bridge/ontology.ttl"
        )

    if not ontology_path.is_file():
        raise OntologyLoadError(
            f"Ontology path exists but is not a file: {ontology_path}"
        )

    if ontology_path.stat().st_size == 0:
        raise OntologyLoadError(
            f"Ontology file is empty: {ontology_path}"
        )

    # Parse TTL file with RDFLib
    try:
        graph = Graph()
        graph.parse(str(ontology_path), format='turtle')
    except Exception as e:
        raise OntologyLoadError(
            f"Failed to parse ontology.ttl as Turtle RDF: {e}"
        ) from e

    # Validate non-empty graph
    if len(graph) == 0:
        raise OntologyLoadError(
            "Ontology graph is empty after parsing (no triples found)"
        )

    # Extract entity classes (owl:Class instances)
    entities = []
    for subj in graph.subjects(RDF.type, OWL.Class):
        # Get the local name (after the last # or /)
        entity_name = str(subj).split('#')[-1].split('/')[-1]
        if entity_name and entity_name != 'ChatEntity':  # Skip base class
            entities.append(entity_name)

    # Extract relationship properties (owl:ObjectProperty or rdfs:subPropertyOf)
    relationships = []
    for subj in graph.subjects(RDF.type, OWL.ObjectProperty):
        rel_name = str(subj).split('#')[-1].split('/')[-1]
        if rel_name:
            relationships.append(rel_name)

    # Validate expected namespaces are present
    namespaces = list(graph.namespaces())
    ns_prefixes = [prefix for prefix, _ in namespaces]

    if not any(prefix in ['', 'rdf', 'rdfs', 'owl'] for prefix in ns_prefixes):
        raise OntologyLoadError(
            f"Ontology missing expected namespaces (rdf, rdfs, owl). Found: {ns_prefixes}"
        )

    # Return structured ontology data
    return {
        'entities': sorted(entities),
        'relationships': sorted(relationships),
        'triple_count': len(graph),
        'raw_graph': graph,
        'source_file': str(ontology_path)
    }


def ontology_to_json_legacy_format() -> Dict[str, Any]:
    """
    Load ontology and convert to legacy JSON format for backwards compatibility.

    This format matches the old ontology.json structure that cognify expects.

    Returns:
        Dictionary with 'entities' and 'relationships' lists
    """
    try:
        ontology = load_ontology()
        return {
            'entities': ontology['entities'],
            'relationships': ontology['relationships']
        }
    except OntologyLoadError:
        # Re-raise with same error for consistency
        raise


def main():
    """CLI entry point for testing ontology loading."""
    try:
        ontology = load_ontology()
        print(json.dumps({
            'success': True,
            'entities': ontology['entities'],
            'relationships': ontology['relationships'],
            'triple_count': ontology['triple_count'],
            'source_file': ontology['source_file']
        }, indent=2))
    except OntologyLoadError as e:
        print(json.dumps({
            'success': False,
            'error': str(e)
        }, indent=2))
        return 1
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': f'Unexpected error: {e}'
        }, indent=2))
        return 1

    return 0


if __name__ == '__main__':
    import sys
    sys.exit(main())
