using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using MelonLoader;

namespace Canary.Diagnostics;

// Works out which mod an error came from: the first stack frame (or the logger's class) that belongs to a
// loaded mod or plugin. Anything else is "game". Only runs when a new error group is created.
internal static class ModAttribution
{
    private static readonly object Lock = new();
    private static Dictionary<Assembly, string> _assemblies;
    private static Dictionary<string, string> _types;

    public static string For(Exception exception, string unityStack, string loggerName)
    {
        try
        {
            Build();
            if (exception != null)
            {
                for (var e = exception; e != null; e = e.InnerException)
                {
                    var frames = new System.Diagnostics.StackTrace(e, false).GetFrames() ?? [];
                    foreach (var frame in frames)
                    {
                        var assembly = frame.GetMethod()?.DeclaringType?.Assembly;
                        if (assembly != null && _assemblies.TryGetValue(assembly, out var mod)) return mod;
                    }
                }
            }
            if (!string.IsNullOrEmpty(unityStack))
            {
                foreach (var line in unityStack.Split('\n'))
                {
                    var mod = ForTypeName(TypeOfFrame(line.Trim()));
                    if (mod != null) return mod;
                }
            }
            return ForTypeName(loggerName) ?? "game";
        }
        catch
        {
            return "unknown";
        }
    }

    // "Some.Namespace.Type.Method (args) (at file:line)" -> "Some.Namespace.Type"
    private static string TypeOfFrame(string line)
    {
        var paren = line.IndexOf(" (", StringComparison.Ordinal);
        var call = paren > 0 ? line.Substring(0, paren) : line;
        var dot = call.LastIndexOf('.');
        return dot > 0 ? call.Substring(0, dot) : null;
    }

    private static string ForTypeName(string typeName)
    {
        if (string.IsNullOrEmpty(typeName)) return null;
        // Nested types print as Outer+Inner or Outer/Inner depending on where the name came from.
        var name = typeName.Replace('/', '+');
        return _types.TryGetValue(name, out var mod) ? mod : null;
    }

    private static void Build()
    {
        if (_assemblies != null) return;
        lock (Lock)
        {
            if (_assemblies != null) return;
            var assemblies = new Dictionary<Assembly, string>();
            var types = new Dictionary<string, string>();
            foreach (var melon in MelonBase.RegisteredMelons)
            {
                var assembly = melon.MelonAssembly?.Assembly;
                if (assembly == null || assemblies.ContainsKey(assembly)) continue;
                assemblies[assembly] = melon.Info.Name;
                foreach (var type in SafeTypes(assembly))
                    if (type.FullName != null) types[type.FullName] = melon.Info.Name;
            }
            _types = types;
            _assemblies = assemblies;
        }
    }

    private static IEnumerable<Type> SafeTypes(Assembly assembly)
    {
        try
        {
            return assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException e)
        {
            return e.Types.Where(t => t != null);
        }
    }
}
